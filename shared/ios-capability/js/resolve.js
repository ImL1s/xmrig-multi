/**
 * iOS capability resolver (#60).
 */

/**
 * @typedef {'sideload-miner'|'source-build'|'app-store-companion'|'unverified'} DistChannel
 */

/**
 * @param {object} input
 * @param {DistChannel} input.channel
 * @param {boolean} [input.binaryPresent]
 * @param {string|null} [input.binaryHash]
 * @param {string|null} [input.binaryVersion]
 * @param {boolean} [input.selftestPassed]
 * @param {string[]} [input.acceptedConfigKeys]
 * @param {boolean|null} [input.jitActuallyUsed]
 * @param {boolean|null} [input.backgroundMiningSupported]
 * @param {number|null} [input.memoryBudgetBytes]
 * @param {string} [input.evidenceDate]
 * @param {boolean} [input.signingOk]
 */
export function resolveIosCapability(input = {}) {
    const channel = input.channel || 'unverified';
    const reasons = [];
    const warnings = [];

    if (channel === 'app-store-companion') {
        return {
            channel,
            canMineOnDevice: false,
            miningBlockedReason: 'App Store companion builds must not claim on-device mining (guideline 3.1.5(ii))',
            randomx: {
                mode: 'unavailable',
                jit: false,
                jitStatus: 'unsupported',
                acceptedKeys: []
            },
            background: {
                reliable: false,
                status: 'not-applicable',
                reason: 'companion has no local miner'
            },
            binary: {
                present: false,
                hash: null,
                version: null,
                verified: false
            },
            evidenceKind: input.evidenceDate ? 'documented' : 'policy',
            evidenceDate: input.evidenceDate || null,
            reasons: ['channel=app-store-companion'],
            warnings: ['Do not reuse sideload marketing copy for App Store listing']
        };
    }

    const binaryPresent = !!input.binaryPresent;
    const selftest = !!input.selftestPassed;
    const signingOk = input.signingOk !== false;
    const accepted = Array.isArray(input.acceptedConfigKeys) ? [...input.acceptedConfigKeys] : [];

    if (!binaryPresent) {
        reasons.push('bundled miner binary missing');
    }
    if (!selftest) {
        reasons.push('engine selftest not passed / unverified');
    }
    if (!signingOk) {
        reasons.push('signing/provisioning not OK for this install');
    }

    const canMine = binaryPresent && selftest && signingOk && channel !== 'unverified';

    let jitStatus = 'unverified';
    let jit = false;
    if (!canMine) {
        jitStatus = 'unavailable';
    } else if (input.jitActuallyUsed === true && accepted.includes('randomx.jit')) {
        jit = true;
        jitStatus = 'verified-on';
    } else if (input.jitActuallyUsed === false) {
        jit = false;
        jitStatus = 'verified-off-fallback-interpreter';
        warnings.push('JIT not active — using interpreter/light path');
    } else if (accepted.includes('randomx.jit')) {
        jitStatus = 'key-accepted-unverified-runtime';
        warnings.push('config accepts jit key but runtime use unverified');
        jit = false; // fail closed until proven
    } else {
        jitStatus = 'unsupported';
        jit = false;
    }

    const bgSupported = input.backgroundMiningSupported === true;
    const background = {
        reliable: false,
        status: bgSupported ? 'limited-unverified' : 'unsupported',
        reason: bgSupported
            ? 'OS may suspend; never promise permanent background mining'
            : 'No reliable background mining on iOS — foreground/sideload session only'
    };

    return {
        channel,
        canMineOnDevice: canMine,
        miningBlockedReason: canMine ? null : reasons.join('; ') || 'capability insufficient',
        randomx: {
            mode: canMine ? 'light' : 'unavailable',
            jit,
            jitStatus,
            acceptedKeys: accepted,
            memoryBudgetBytes: input.memoryBudgetBytes ?? null
        },
        background,
        binary: {
            present: binaryPresent,
            hash: input.binaryHash || null,
            version: input.binaryVersion || null,
            verified: binaryPresent && selftest
        },
        evidenceKind: selftest ? 'selftest' : 'unverified',
        evidenceDate: input.evidenceDate || null,
        reasons,
        warnings
    };
}

/**
 * Build effective RandomX config fragment for XMRig JSON.
 * Never emits jit:true unless capability says verified-on.
 * @param {ReturnType<typeof resolveIosCapability>} cap
 */
export function effectiveRandomxConfig(cap) {
    if (!cap.canMineOnDevice) {
        return {
            ok: false,
            config: null,
            reason: cap.miningBlockedReason || 'cannot mine'
        };
    }
    return {
        ok: true,
        config: {
            mode: 'light',
            '1gb-pages': false,
            rdmsr: false,
            wrmsr: false,
            cache_qos: false,
            numa: false,
            jit: cap.randomx.jit === true,
            scratchpad_prefetch_mode: 1
        },
        reason: cap.randomx.jit ? 'light+verified-jit' : 'light+jit-off-fail-closed'
    };
}
