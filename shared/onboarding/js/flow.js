/**
 * Three-step onboarding state machine (#56).
 */

/** @typedef {'capability'|'payout'|'load'|'summary'} OnboardingStep */

const STEPS = ['capability', 'payout', 'load', 'summary'];

/**
 * @param {object} [seed]
 */
export function createOnboarding(seed = {}) {
    return {
        step: seed.step || 'capability',
        skippedWizard: Boolean(seed.skippedWizard),
        capabilities: seed.capabilities || {},
        draft: {
            coin: null,
            walletAddress: '',
            poolId: null,
            poolUrl: '',
            loadProfile: 'balanced',
            calibrate: false,
            threads: null,
            ...(seed.draft || {})
        },
        running: seed.running || null,
        history: Array.isArray(seed.history) ? [...seed.history] : []
    };
}

export function skipToAdvanced(state) {
    return {
        ...state,
        skippedWizard: true,
        step: 'summary',
        history: [...state.history, { action: 'skip_wizard', from: state.step }]
    };
}

export function goNext(state) {
    const idx = STEPS.indexOf(state.step);
    if (idx < 0 || idx >= STEPS.length - 1) return state;
    const blockers = stepBlockers(state, state.step);
    if (blockers.length) {
        return { ...state, lastBlockers: blockers };
    }
    return {
        ...state,
        step: STEPS[idx + 1],
        lastBlockers: [],
        history: [...state.history, { action: 'next', from: state.step }]
    };
}

export function goBack(state) {
    const idx = STEPS.indexOf(state.step);
    if (idx <= 0) return state;
    return {
        ...state,
        step: STEPS[idx - 1],
        history: [...state.history, { action: 'back', from: state.step }],
        // draft preserved intentionally
        draft: { ...state.draft }
    };
}

export function updateDraft(state, patch = {}) {
    return {
        ...state,
        draft: { ...state.draft, ...patch }
    };
}

/**
 * Reasons a control cannot proceed — never silent disable.
 */
export function stepBlockers(state, step = state.step) {
    const d = state.draft || {};
    const caps = state.capabilities || {};
    switch (step) {
        case 'capability':
            if (caps.engineReady === false) {
                return [{ code: 'engine_unavailable', fix: 'Install a build with a mining engine or use companion mode' }];
            }
            return [];
        case 'payout': {
            const out = [];
            if (!d.coin) out.push({ code: 'coin_required', fix: 'Select a payout coin' });
            if (d.coin && caps.coins && caps.coins[d.coin] === 'unavailable') {
                out.push({ code: 'coin_unsupported', fix: 'Pick a supported coin or view-only settings' });
            }
            if (!String(d.walletAddress || '').trim()) {
                out.push({ code: 'wallet_required', fix: 'Paste your wallet address' });
            }
            if (d.walletInvalid) {
                out.push({ code: 'wallet_invalid', fix: 'Correct the address checksum / network' });
            }
            if (!d.poolId && !String(d.poolUrl || '').trim()) {
                out.push({ code: 'pool_required', fix: 'Choose a verified preset or enter a custom endpoint' });
            }
            if (d.poolUnreachable) {
                out.push({ code: 'pool_unreachable', fix: 'Check network or pick another pool' });
            }
            if (caps.offline && !d.allowOfflineDraft) {
                out.push({ code: 'offline', fix: 'You can still edit draft offline; Start needs connectivity' });
            }
            return out;
        }
        case 'load':
            if (d.lowMemory && d.loadProfile === 'max') {
                return [{ code: 'low_memory', fix: 'Choose balanced/efficiency or enable light mode' }];
            }
            return [];
        case 'summary':
            return canStart(state).blockers;
        default:
            return [];
    }
}

/**
 * Start is always an explicit user action — never from open/paste/ToS.
 */
export function canStart(state, trigger = 'user_start') {
    const blockers = [];
    if (trigger !== 'user_start') {
        blockers.push({ code: 'implicit_start_forbidden', fix: 'Press Start explicitly' });
    }
    if (!state?.draft) {
        blockers.push({ code: 'no_draft', fix: 'Complete setup' });
        return { ok: false, blockers };
    }
    for (const step of ['capability', 'payout', 'load']) {
        blockers.push(...stepBlockers({ ...state, step }, step));
    }
    if (state.running && state.running.active) {
        blockers.push({ code: 'already_running', fix: 'Stop the current session first' });
    }
    return { ok: blockers.length === 0, blockers };
}

/**
 * Launch summary for the pre-start panel.
 */
export function launchSummary(state) {
    const d = state.draft || {};
    const addr = String(d.walletAddress || '');
    const elided = addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : (addr || '—');
    return {
        engine: state.capabilities?.engineName || 'unknown',
        coin: d.coin || null,
        endpoint: d.poolUrl || d.poolId || null,
        walletElided: elided,
        threads: d.threads,
        loadProfile: d.loadProfile,
        calibrate: Boolean(d.calibrate),
        feesKnown: state.capabilities?.feesKnown ?? false,
        draftSeparateFromRunning: !state.running || JSON.stringify(state.running.config) !== JSON.stringify(d)
    };
}

export { STEPS };
