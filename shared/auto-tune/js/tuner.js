/**
 * Auto-tune orchestrator (#34/#128).
 * Independent of UI ViewModels — cancel, locks, rollback, fingerprint stale.
 * Synthetic fakeBenchmark is never the default; callers must pass an adapter.
 */

import { buildCandidates } from './candidates.js';
import { fakeBenchmark } from './benchmark.js';
import { isFingerprintStale, tuneFingerprint } from './fingerprint.js';

/** @typedef {'quiet'|'power'|'balanced'|'max_sustained'} TuneGoal */
/** @typedef {'idle'|'running'|'cancelled'|'completed'|'aborted'} TunePhase */

/**
 * @param {object} options
 * @param {object} options.snapshot
 * @param {TuneGoal} [options.goal]
 * @param {string} [options.algorithm]
 * @param {string} [options.engineBuild]
 * @param {string[]} [options.lockedFields]
 * @param {number} [options.lockedThreads]
 * @param {string} [options.lockedRandomxMode]
 * @param {object} [options.baseline] current settings { threads, randomxMode }
 * @param {object} [options.powerPolicy]
 * @param {object} [options.memoryPolicy]
 * @param {(c: object, ctx: object) => Promise<object>} options.benchmark required live or explicit fake
 * @param {object} [options.benchmarkCtx]
 * @param {'synthetic'|'live'} [options.benchmarkKind] default: synthetic iff benchmark===fakeBenchmark else live
 * @param {() => boolean} [options.shouldAbort] thermal/battery/memory/user
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.minImprovementPct] ignore noisy tiny wins (default 3)
 */
export async function runAutoTune(options = {}) {
    const goal = options.goal || 'balanced';
    const warnings = [];
    const samples = [];
    const fp = tuneFingerprint({
        snapshot: options.snapshot,
        engineBuild: options.engineBuild,
        algorithm: options.algorithm || 'rx/0',
        powerPolicy: options.powerPolicy,
        memoryPolicy: options.memoryPolicy
    });

    if (!options.snapshot) {
        return uncalibrated('no hardware snapshot', fp);
    }

    if (typeof options.benchmark !== 'function') {
        return uncalibrated('no benchmark adapter — refuse synthetic default', fp);
    }

    const adapterKind =
        options.benchmarkKind ||
        (options.benchmark === fakeBenchmark ? 'synthetic' : 'live');

    const { candidates, reasons } = buildCandidates({
        snapshot: options.snapshot,
        algorithm: options.algorithm,
        lockedFields: options.lockedFields,
        lockedThreads: options.lockedThreads,
        lockedRandomxMode: options.lockedRandomxMode,
        goal
    });
    warnings.push(...reasons);

    if (!candidates.length) {
        return {
            phase: 'aborted',
            ok: false,
            accepted: false,
            recommendation: null,
            baseline: options.baseline || null,
            fingerprint: fp,
            stale: false,
            samples,
            warnings: [...warnings, 'no safe candidates'],
            claims: claimFlags(options, adapterKind, samples)
        };
    }

    const bench = options.benchmark;
    const minImp = options.minImprovementPct ?? 3;
    let best = null;
    let bestScore = -Infinity;

    const stopped = () => Boolean(options.signal?.aborted || options.shouldAbort?.());

    for (const candidate of candidates) {
        if (stopped()) {
            return earlyStop(options, fp, samples, warnings, adapterKind);
        }

        const result = await bench(candidate, {
            ...(options.benchmarkCtx || {}),
            abortSignal: options.signal
        });

        // Re-check cancel after every await (#128).
        if (stopped() || result.cancelled) {
            return earlyStop(options, fp, samples, warnings, adapterKind, result);
        }

        const score = scoreResult(goal, result, candidate, options);
        samples.push({
            candidate,
            result: {
                ok: result.ok,
                hashrate: result.hashrate,
                watts: result.watts,
                hashesPerJoule: result.hashesPerJoule,
                loadProxy: result.loadProxy,
                thermalThrottle: result.thermalThrottle,
                confidence: result.confidence,
                timedOut: result.timedOut,
                cancelled: result.cancelled,
                notes: result.notes
            },
            score,
            measured: adapterKind === 'live' && result.ok,
            estimated: adapterKind !== 'live' || !result.ok,
            provenance: adapterKind
        });

        if (result.ok && !result.thermalThrottle && score > bestScore) {
            bestScore = score;
            best = { candidate, result, score };
        }
    }

    if (stopped()) {
        return earlyStop(options, fp, samples, warnings, adapterKind);
    }

    const baseline = options.baseline || null;
    let improvementPct = null;
    if (best && baseline) {
        const baseCandidate = {
            id: `t${baseline.threads}-${baseline.randomxMode || 'light'}`,
            threads: baseline.threads,
            randomxMode: baseline.randomxMode || 'light'
        };
        const baseBench = await bench(baseCandidate, {
            ...(options.benchmarkCtx || {}),
            abortSignal: options.signal
        });
        if (stopped() || baseBench.cancelled) {
            return earlyStop(options, fp, samples, warnings, adapterKind, baseBench);
        }
        if (baseBench.ok) {
            const baseScore = scoreResult(goal, baseBench, baseCandidate, options);
            if (Number.isFinite(baseScore) && Math.abs(baseScore) > 1e-12) {
                improvementPct = ((best.score - baseScore) / Math.abs(baseScore)) * 100;
            } else if (best.score > baseScore) {
                improvementPct = 100;
            } else {
                improvementPct = 0;
            }
            if (improvementPct < minImp) {
                warnings.push(
                    `best within noise (<${minImp}% vs baseline on goal score) — keep baseline`
                );
                return {
                    phase: 'completed',
                    ok: true,
                    accepted: false,
                    recommendation: {
                        threads: baseline.threads,
                        randomxMode: baseline.randomxMode || 'light',
                        reason: 'no meaningful improvement over baseline',
                        confidence: 'medium',
                        improvementPct
                    },
                    baseline,
                    fingerprint: fp,
                    stale: false,
                    samples,
                    warnings,
                    claims: claimFlags(options, adapterKind, samples),
                    rollback: baseline
                };
            }
        }
    }

    if (!best) {
        return {
            phase: 'completed',
            ok: false,
            accepted: false,
            recommendation: conservativeSuggestion(options.snapshot, warnings),
            baseline,
            fingerprint: fp,
            stale: false,
            samples,
            warnings: [...warnings, 'all candidates failed — conservative suggestion only'],
            claims: claimFlags(options, adapterKind, samples),
            rollback: baseline
        };
    }

    return {
        phase: 'completed',
        ok: true,
        accepted: false, // caller must explicitly accept before persist
        recommendation: {
            threads: best.candidate.threads,
            randomxMode: best.candidate.randomxMode,
            reason: `best for goal=${goal}`,
            confidence: best.result.confidence,
            score: best.score,
            improvementPct,
            hashrate: best.result.hashrate,
            watts: best.result.watts,
            hashesPerJoule: best.result.hashesPerJoule,
            loadProxy: best.result.loadProxy
        },
        baseline,
        fingerprint: fp,
        stale: false,
        samples,
        warnings,
        claims: claimFlags(options, adapterKind, samples),
        rollback: baseline
    };
}

/**
 * Apply only after user accept; returns new settings + whether fingerprint still valid.
 */
export function acceptTuneResult(tuneResult, currentFingerprint) {
    if (!tuneResult?.recommendation || !tuneResult.ok) {
        return { ok: false, settings: null, reason: 'no recommendation' };
    }
    if (isFingerprintStale(tuneResult.fingerprint?.hash, currentFingerprint)) {
        return {
            ok: false,
            settings: null,
            reason: 'fingerprint stale — recalibrate (do not blind-apply)'
        };
    }
    return {
        ok: true,
        settings: {
            threads: tuneResult.recommendation.threads,
            randomxMode: tuneResult.recommendation.randomxMode
        },
        reason: 'accepted by user'
    };
}

export function rollbackSettings(tuneResult) {
    return tuneResult?.rollback || tuneResult?.baseline || null;
}

function earlyStop(options, fp, samples, warnings, adapterKind, lastResult) {
    const cancelled = Boolean(options.signal?.aborted || lastResult?.cancelled);
    return {
        phase: cancelled ? 'cancelled' : 'aborted',
        ok: false,
        accepted: false,
        recommendation: null,
        baseline: options.baseline || null,
        fingerprint: fp,
        stale: false,
        samples,
        warnings: [...warnings, 'tune stopped early — no orphan workers'],
        claims: claimFlags(options, adapterKind, samples),
        rollback: options.baseline || null
    };
}

function scoreResult(goal, result, candidate, options) {
    if (!result.ok) return -Infinity;
    if (result.thermalThrottle) return -1e9;
    const hr = result.hashrate;
    const load = result.loadProxy || candidate.threads;
    switch (goal) {
        case 'max_sustained':
            return hr;
        case 'power': {
            if (result.hashesPerJoule != null) return result.hashesPerJoule;
            // Proxy: prefer hashrate per thread when no watts
            return hr / Math.max(1, candidate.threads);
        }
        case 'quiet': {
            // Prefer lower load proxy; if noise sensor absent, label as proxy in claims
            return hr / Math.max(1, load * load);
        }
        case 'balanced':
        default:
            return hr / Math.sqrt(Math.max(1, load));
    }
}

function claimFlags(options, adapterKind, samples = []) {
    const powerReadable = options.snapshot?.sensors?.powerReadable?.value === true;
    const noiseReadable = options.snapshot?.sensors?.noiseReadable?.value === true;
    const live = adapterKind === 'live';
    const anyOk = samples.some((s) => s.result?.ok);
    const anyWatts = samples.some(
        (s) => s.result?.watts != null && Number(s.result.watts) > 0
    );
    return {
        measuredHashrate: live && anyOk,
        measuredHashesPerWatt: live && powerReadable && anyWatts,
        measuredQuiet: live && noiseReadable,
        quietUsesLoadProxy: !noiseReadable,
        estimatedOnly: !live,
        adapterKind: adapterKind || 'none'
    };
}

function uncalibrated(reason, fp) {
    return {
        phase: 'idle',
        ok: false,
        accepted: false,
        recommendation: {
            threads: 1,
            randomxMode: 'light',
            reason: `uncalibrated: ${reason}`,
            confidence: 'low'
        },
        baseline: null,
        fingerprint: fp,
        stale: true,
        samples: [],
        warnings: [reason, 'use conservative defaults or skip calibration'],
        claims: {
            measuredHashrate: false,
            measuredHashesPerWatt: false,
            measuredQuiet: false,
            quietUsesLoadProxy: true,
            estimatedOnly: true,
            adapterKind: 'none'
        },
        rollback: null
    };
}

function conservativeSuggestion(snapshot, warnings) {
    const allowed = snapshot?.cpu?.allowed?.value ?? snapshot?.cpu?.logical?.value ?? 1;
    const threads = Math.max(1, Math.min(allowed, Math.max(1, allowed - 1)));
    warnings.push('conservative suggestion (uncalibrated path)');
    return {
        threads,
        randomxMode: 'light',
        reason: 'conservative fallback',
        confidence: 'low'
    };
}
