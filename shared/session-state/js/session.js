/**
 * Cross-platform mining session state machine (#48).
 * UI must follow session owner transitions — not button clicks alone.
 */

export const SessionPhase = Object.freeze({
    Idle: 'Idle',
    Validating: 'Validating',
    Starting: 'Starting',
    Connecting: 'Connecting',
    Authorized: 'Authorized',
    Initializing: 'Initializing',
    Hashing: 'Hashing',
    WaitingForShare: 'WaitingForShare',
    Reconnecting: 'Reconnecting',
    PolicyPaused: 'PolicyPaused',
    Stopping: 'Stopping',
    Stopped: 'Stopped',
    Failed: 'Failed'
});

const ALLOWED = {
    [SessionPhase.Idle]: ['Validating', 'Starting'],
    [SessionPhase.Validating]: ['Starting', 'Failed', 'Idle'],
    [SessionPhase.Starting]: ['Connecting', 'Hashing', 'Failed', 'Stopping'],
    [SessionPhase.Connecting]: ['Authorized', 'Hashing', 'Reconnecting', 'Failed', 'Stopping'],
    [SessionPhase.Authorized]: ['Initializing', 'Hashing', 'Failed', 'Stopping'],
    [SessionPhase.Initializing]: ['Hashing', 'WaitingForShare', 'Failed', 'Stopping'],
    [SessionPhase.Hashing]: ['WaitingForShare', 'Reconnecting', 'PolicyPaused', 'Stopping', 'Failed', 'Stopped'],
    [SessionPhase.WaitingForShare]: ['Hashing', 'Reconnecting', 'PolicyPaused', 'Stopping', 'Failed', 'Stopped'],
    [SessionPhase.Reconnecting]: ['Connecting', 'Hashing', 'Failed', 'Stopping', 'Stopped'],
    [SessionPhase.PolicyPaused]: ['Hashing', 'Stopping', 'Stopped', 'Failed'],
    [SessionPhase.Stopping]: ['Stopped', 'Failed'],
    [SessionPhase.Stopped]: ['Idle', 'Validating', 'Starting'],
    [SessionPhase.Failed]: ['Idle', 'Validating', 'Starting', 'Stopping']
};

export function createSession(seed = {}) {
    return {
        sessionId: seed.sessionId || null,
        revision: seed.revision || 0,
        phase: seed.phase || SessionPhase.Idle,
        reason: seed.reason || null,
        updatedAt: seed.updatedAt || Date.now(),
        processAlive: seed.processAlive ?? false,
        workActive: seed.workActive ?? false,
        shareAccepted: seed.shareAccepted ?? false
    };
}

/**
 * @param {ReturnType<typeof createSession>} state
 * @param {{ type: string, phase?: string, reason?: string, sessionId?: string, processAlive?: boolean, workActive?: boolean, shareAccepted?: boolean, at?: number }} event
 */
export function reduceSession(state, event) {
    const at = event.at || Date.now();
    switch (event.type) {
        case 'RESET':
            return createSession({ updatedAt: at });
        case 'BEGIN': {
            if (![SessionPhase.Idle, SessionPhase.Stopped, SessionPhase.Failed].includes(state.phase)) {
                return { ...state, reason: 'start ignored — session busy', updatedAt: at };
            }
            return {
                ...state,
                sessionId: event.sessionId || `s-${at}`,
                revision: state.revision + 1,
                phase: SessionPhase.Starting,
                reason: event.reason || 'user-start',
                updatedAt: at,
                processAlive: false,
                workActive: false,
                shareAccepted: false
            };
        }
        case 'TRANSITION': {
            const next = event.phase;
            const allowed = ALLOWED[state.phase] || [];
            if (!allowed.includes(next)) {
                return {
                    ...state,
                    reason: `ignored transition ${state.phase}→${next}`,
                    updatedAt: at
                };
            }
            return {
                ...state,
                revision: state.revision + 1,
                phase: next,
                reason: event.reason || state.reason,
                updatedAt: at,
                processAlive: event.processAlive ?? state.processAlive,
                workActive: event.workActive ?? state.workActive,
                shareAccepted: event.shareAccepted ?? state.shareAccepted
            };
        }
        case 'PROCESS_EXIT': {
            // Authoritative: process gone → Failed or Stopped, never stay Hashing
            const phase = state.phase === SessionPhase.Stopping || event.reason === 'user-stop'
                ? SessionPhase.Stopped
                : SessionPhase.Failed;
            return {
                ...state,
                revision: state.revision + 1,
                phase,
                reason: event.reason || 'process-exit',
                updatedAt: at,
                processAlive: false,
                workActive: false
            };
        }
        case 'SNAPSHOT':
            // Rebuild from owner snapshot (UI remount)
            return {
                ...createSession(event),
                revision: (event.revision ?? state.revision) + 1,
                updatedAt: at
            };
        default:
            return state;
    }
}

export function canStart(state) {
    return [SessionPhase.Idle, SessionPhase.Stopped, SessionPhase.Failed].includes(state.phase);
}

export function canStop(state) {
    return ![SessionPhase.Idle, SessionPhase.Stopped, SessionPhase.Stopping].includes(state.phase);
}

export function uiLabel(phase) {
    switch (phase) {
        case SessionPhase.Hashing:
        case SessionPhase.WaitingForShare:
            return 'Mining';
        case SessionPhase.Starting:
        case SessionPhase.Connecting:
        case SessionPhase.Authorized:
        case SessionPhase.Initializing:
            return 'Starting…';
        case SessionPhase.Reconnecting:
            return 'Reconnecting…';
        case SessionPhase.PolicyPaused:
            return 'Paused (policy)';
        case SessionPhase.Stopping:
            return 'Stopping…';
        case SessionPhase.Failed:
            return 'Failed';
        case SessionPhase.Stopped:
            return 'Stopped';
        default:
            return 'Idle';
    }
}
