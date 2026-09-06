/**
 * Pool recommendation + first-share wait model (#42).
 * Ranking is deterministic given the same inputs; never invents payouts.
 */

/** Hint → relative affinity for low / mid / high hashrate bands. */
const HINT_SCORE = {
    'low-hashrate-candidate': { low: 30, mid: 10, high: -5 },
    'algo-switching': { low: 20, mid: 15, high: 10 },
    vardiff: { low: 12, mid: 18, high: 15 },
    'high-hashrate-candidate': { low: -20, mid: 5, high: 25 },
    null: { low: 0, mid: 0, high: 0 }
};

const STATUS_SCORE = {
    verified: 40,
    'docs-verified': 25,
    unverified: 5,
    deprecated: -50,
    unavailable: -100
};

/**
 * @param {number|null|undefined} hashrateHs
 * @returns {'unknown'|'low'|'mid'|'high'}
 */
export function hashrateBand(hashrateHs) {
    if (hashrateHs == null || !Number.isFinite(hashrateHs) || hashrateHs <= 0) {
        return 'unknown';
    }
    if (hashrateHs < 50) return 'low';
    if (hashrateHs < 1000) return 'mid';
    return 'high';
}

/**
 * Expected first-share wait under constant difficulty (CryptoNote-style D/H).
 * Returns probability bands — not a payment promise.
 *
 * @param {{ difficulty: number|null|undefined, hashrateHs: number|null|undefined, unit?: string }} input
 */
export function estimateShareWait(input) {
    const { difficulty, hashrateHs, unit = 's' } = input || {};
    if (difficulty == null || !Number.isFinite(difficulty) || difficulty <= 0) {
        return {
            ok: false,
            code: 'difficulty_unknown',
            message: 'Share wait unavailable — difficulty unknown or VARDIFF without sample',
            expectedSeconds: null,
            p50Seconds: null,
            p90Seconds: null,
            disclaimer: 'Estimate only; not a payout guarantee'
        };
    }
    if (hashrateHs == null || !Number.isFinite(hashrateHs) || hashrateHs <= 0) {
        return {
            ok: false,
            code: 'hashrate_unknown',
            message: 'Share wait unavailable — measured hashrate is 0 or unknown',
            expectedSeconds: null,
            p50Seconds: null,
            p90Seconds: null,
            disclaimer: 'Estimate only; not a payout guarantee'
        };
    }

    const expectedSeconds = difficulty / hashrateHs;
    // Exponential: P(T > t) = e^{-t/μ}; p50 = ln2 μ, p90 = ln(10) μ
    const p50Seconds = Math.LN2 * expectedSeconds;
    const p90Seconds = Math.log(10) * expectedSeconds;

    return {
        ok: true,
        code: 'ok',
        message: `Model D/H ≈ ${formatDuration(expectedSeconds)} expected between shares`,
        expectedSeconds,
        p50Seconds,
        p90Seconds,
        unit,
        disclaimer: 'Model estimate from difficulty÷hashrate — not a payment promise'
    };
}

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
    return `${(seconds / 86400).toFixed(1)} d`;
}

/**
 * Score one endpoint for the measured hashrate band.
 * @param {object} endpoint registry endpoint
 * @param {'unknown'|'low'|'mid'|'high'} band
 */
export function scoreEndpoint(endpoint, band) {
    const hint = endpoint?.difficultyHint ?? null;
    const table = HINT_SCORE[hint] || HINT_SCORE.null;
    const b = band === 'unknown' ? 'mid' : band;
    let score = table[b] ?? 0;
    const reasons = [];

    if (hint === 'low-hashrate-candidate' && band === 'low') {
        reasons.push('Endpoint marked low-hashrate-candidate (fits ~3–50 H/s devices)');
    } else if (hint === 'high-hashrate-candidate' && band === 'low') {
        reasons.push('High-difficulty port — may delay first share on low hashrate');
        score -= 15;
    } else if (hint === 'vardiff') {
        reasons.push('VARDIFF — starting difficulty not fixed; wait model needs a job sample');
    } else if (hint === 'algo-switching') {
        reasons.push('Algo-switching pool — often friendlier to low hashrate than fixed high ports');
    } else if (!hint) {
        reasons.push('No difficulty hint — lower confidence');
        score -= 5;
    }

    if (endpoint?.protocolVerifiedAt) {
        score += 10;
        reasons.push(`Protocol verified at ${endpoint.protocolVerifiedAt}`);
    } else {
        reasons.push('Protocol handshake not yet verified (#41)');
    }

    if (endpoint?.tls) {
        score += 3;
        reasons.push('TLS endpoint');
    }

    return { score, reasons, hint };
}

/**
 * Rank compatible stratum pools for a hashrate + preferences.
 * Does not auto-replace a user-locked pool.
 *
 * @param {object} options
 * @param {object[]} options.entries registry entries
 * @param {number|null} [options.hashrateHs]
 * @param {string} [options.miningChain='monero']
 * @param {string} [options.payoutAsset='XMR']
 * @param {string|null} [options.preferRegion]
 * @param {boolean} [options.preferTls]
 * @param {string|null} [options.lockedPoolId] if set, ranking still runs but flag locked
 * @param {number} [options.nowMs]
 */
export function recommendPools(options) {
    const {
        entries = [],
        hashrateHs = null,
        miningChain = 'monero',
        payoutAsset = 'XMR',
        preferRegion = null,
        preferTls = false,
        lockedPoolId = null,
        nowMs = Date.now()
    } = options || {};

    const band = hashrateBand(hashrateHs);
    const ranked = [];

    for (const entry of entries) {
        if (entry.kind !== 'stratum-pool') continue;
        if (entry.miningChain !== miningChain) continue;
        if (entry.payoutAsset !== payoutAsset) continue;
        if (entry.status === 'unavailable' || entry.status === 'deprecated') continue;

        const hardLimits = [];
        if (!Array.isArray(entry.endpoints) || entry.endpoints.length === 0) {
            hardLimits.push('No endpoints');
            continue;
        }

        let bestEp = null;
        let bestScore = -Infinity;
        let bestReasons = [];

        for (const ep of entry.endpoints) {
            let { score, reasons, hint } = scoreEndpoint(ep, band);
            if (preferTls && ep.tls) score += 5;
            if (preferRegion && ep.region && ep.region === preferRegion) score += 8;
            if (preferRegion && ep.region && ep.region !== preferRegion) score -= 4;

            // Freshness / confidence: stale metadata lowers confidence, does not invent values
            const reviewedAgeDays = daysSince(entry.lastReviewedAt, nowMs);
            if (reviewedAgeDays != null && reviewedAgeDays > 180) {
                score -= 8;
                reasons = [...reasons, `Metadata last reviewed ${reviewedAgeDays}d ago — lower confidence`];
            }

            if (score > bestScore) {
                bestScore = score;
                bestEp = ep;
                bestReasons = reasons;
            }
            void hint;
        }

        let poolScore = bestScore + (STATUS_SCORE[entry.status] || 0);
        const reasons = [
            ...bestReasons,
            `Pool status: ${entry.status}`,
            `Hashrate band: ${band}${hashrateHs != null && hashrateHs > 0 ? ` (${hashrateHs} H/s)` : ''}`
        ];

        if (entry.noviceDefault) {
            poolScore += 5;
            reasons.push('Eligible novice default in registry');
        }

        const fee = entry.fees?.poolFee;
        if (fee?.status === 'known' && fee.percent != null) {
            poolScore += Math.max(0, 10 - fee.percent); // lower fee slightly preferred
            reasons.push(`Known pool fee ${fee.percent}% (asOf ${fee.asOf})`);
        } else {
            reasons.push('Pool fee unknown — not scored as 0%');
            poolScore -= 2;
        }

        const minPay = entry.fees?.minPayout;
        if (minPay?.status === 'known' && band === 'low') {
            reasons.push(`Min payout ${minPay.amount} ${minPay.asset} — low hashrate may take long`);
        }

        // Low H/s: boost pools that actually expose a low-hashrate endpoint
        const hasLowPort = (entry.endpoints || []).some(
            (e) => e.difficultyHint === 'low-hashrate-candidate' || e.difficultyHint === 'algo-switching'
        );
        if (band === 'low') {
            if (hasLowPort) {
                poolScore += 15;
                reasons.push('Has low-hashrate or algo-switching endpoint candidate');
            } else {
                poolScore -= 10;
                reasons.push('No low-difficulty port metadata — may delay first share at 3–5 H/s');
                hardLimits.push('No confirmed low-difficulty port in registry');
            }
        }

        ranked.push({
            poolId: entry.id,
            displayName: entry.displayName,
            endpointId: bestEp?.id ?? null,
            host: bestEp?.host ?? null,
            port: bestEp?.port ?? null,
            tls: bestEp?.tls ?? false,
            score: poolScore,
            reasons,
            hardLimits,
            confidence: confidenceLabel(entry, bestEp),
            lastReviewedAt: entry.lastReviewedAt,
            locked: lockedPoolId != null && lockedPoolId === entry.id
        });
    }

    ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.poolId).localeCompare(String(b.poolId));
    });

    return {
        band,
        hashrateHs: hashrateHs ?? null,
        lockedPoolId,
        autoReplaceLocked: false,
        recommendations: ranked,
        top: ranked[0] || null,
        disclaimer:
            'Ranking uses registry metadata + measured hashrate affinity. Ping alone is not profit. Share wait is a model, not a payout guarantee.'
    };
}

function daysSince(isoDate, nowMs) {
    if (!isoDate) return null;
    const t = Date.parse(isoDate);
    if (!Number.isFinite(t)) return null;
    return Math.floor((nowMs - t) / (86400 * 1000));
}

function confidenceLabel(entry, endpoint) {
    if (entry.status === 'verified' && endpoint?.protocolVerifiedAt) return 'high';
    if (entry.status === 'docs-verified') return 'medium';
    return 'low';
}

/**
 * UI-facing status when waiting for first share (not "device too slow").
 * @param {{ acceptedShares: number, hasJob: boolean, authError: boolean, initializing: boolean, waitedSeconds: number, estimate: ReturnType<typeof estimateShareWait>|null }} s
 */
export function firstShareStatus(s) {
    if (s.authError) {
        return { code: 'auth_error', message: 'Pool rejected login — check wallet / worker', severity: 'error' };
    }
    if (s.initializing) {
        return { code: 'initializing', message: 'Initializing miner / RandomX cache', severity: 'info' };
    }
    if (!s.hasJob) {
        return { code: 'no_job', message: 'Connected but no job yet', severity: 'warn' };
    }
    if (s.acceptedShares > 0) {
        return { code: 'share_accepted', message: 'At least one share accepted', severity: 'ok' };
    }
    const est = s.estimate;
    if (est?.ok && s.waitedSeconds < (est.p90Seconds || Infinity)) {
        return {
            code: 'waiting_share',
            message: `Waiting for first share (model p90 ≈ ${formatDuration(est.p90Seconds)})`,
            severity: 'info'
        };
    }
    if (est?.ok && s.waitedSeconds >= (est.p90Seconds || 0)) {
        return {
            code: 'waiting_share_long',
            message: 'Still waiting past model p90 — not necessarily a device fault (VARDIFF/network/luck)',
            severity: 'warn'
        };
    }
    return {
        code: 'waiting_share_unknown',
        message: 'Waiting for first share — difficulty/hashrate model unavailable',
        severity: 'info'
    };
}
