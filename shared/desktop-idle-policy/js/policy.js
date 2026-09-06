/**
 * Desktop idle / session convenience reducer (#77).
 */

import { capabilityMatrix } from './matrix.js';

export const DEFAULTS = Object.freeze({
  idleMineAfterMs: 5 * 60_000,
  pauseWhenActive: true,
  pauseOnUnplug: true,
  keepAwakeConsent: false,
  loginAutostart: false,
  resumeLastSessionOnLaunch: false,
  respectSleep: true
});

/**
 * @typedef {object} DesktopIntent
 * @property {boolean} miningArmed
 * @property {number} userStopRevision
 * @property {number} sessionArmedRevision
 */

/**
 * @param {Partial<DesktopIntent>} [base]
 * @returns {DesktopIntent}
 */
export function armDesktopMining(base = {}) {
  const stop = Number(base.userStopRevision) || 0;
  return {
    miningArmed: true,
    userStopRevision: stop,
    sessionArmedRevision: stop
  };
}

/**
 * @param {Partial<DesktopIntent>} [base]
 * @returns {DesktopIntent}
 */
export function latchUserStop(base = {}) {
  const stop = (Number(base.userStopRevision) || 0) + 1;
  return {
    miningArmed: false,
    userStopRevision: stop,
    sessionArmedRevision: Number(base.sessionArmedRevision) || 0
  };
}

/**
 * @param {object} input
 */
export function evaluateDesktopIdle(input = {}) {
  const os = input.os || 'linux';
  const matrix = capabilityMatrix(os);
  const cfg = { ...DEFAULTS, ...(input.config || {}) };
  const intent = {
    miningArmed: false,
    userStopRevision: 0,
    sessionArmedRevision: 0,
    ...(input.intent || {})
  };
  const event = input.event || { kind: 'tick' };
  const idleMsKnown = typeof input.idleMs === 'number' && Number.isFinite(input.idleMs);
  const idleReliable =
    idleMsKnown &&
    input.idleReliable !== false &&
    (matrix.idleTimer.state === 'available' ||
      matrix.idleTimer.state === 'app-layer' ||
      input.forceIdleReliable === true);

  /** @type {string[]} */
  const reasons = [];

  if (intent.userStopRevision > intent.sessionArmedRevision) {
    return verdict('Stopped', ['User Stop latched — idle/autostart cannot revive'], intent, {
      tray: 'Stopped',
      billEnergy: false
    });
  }

  if (!intent.miningArmed && !input.manualStart) {
    return verdict('Waiting', ['Mining not armed — explicit start required'], intent, {
      tray: 'Waiting',
      billEnergy: false
    });
  }

  // Sleep / lid — default respect
  if (event.kind === 'sleep' || event.kind === 'lid-close' || input.systemSleeping) {
    if (cfg.respectSleep || !cfg.keepAwakeConsent) {
      return verdict(
        'Paused',
        ['Respecting sleep/lid — keep-awake requires explicit consent'],
        intent,
        { tray: 'Paused', billEnergy: false, releaseWake: true }
      );
    }
  }

  if (event.kind === 'wake') {
    // Re-validate on wake; caller must supply fresh power/thermal/budget.
    reasons.push('Wake: re-validating power / thermal / budget');
  }

  // Power
  const onBattery = input.onBattery === true;
  const acKnown = input.onBattery === true || input.onBattery === false;
  if (cfg.pauseOnUnplug) {
    if (!acKnown) {
      return verdict('Waiting', ['AC presence unknown — will not assume plugged'], intent, {
        tray: 'Waiting',
        billEnergy: false
      });
    }
    if (onBattery) {
      return verdict('Paused', ['Paused on battery / unplugged'], intent, {
        tray: 'Paused',
        billEnergy: false
      });
    }
  }

  // Screen lock / session — mining may continue if authorized; status distinct
  if (event.kind === 'session-lock') {
    reasons.push('Session locked — continuing only if already authorized');
  }

  // Active user / idle
  if (cfg.pauseWhenActive) {
    if (!idleReliable) {
      if (matrix.pauseOnActive.state === 'available' && input.enginePauseOnActiveArmed) {
        // Native engine handles active detection — app waits without assuming idle.
        return verdict(
          'Waiting',
          [
            'Idle timestamp unreliable — relying on native pause-on-active; manual pause available'
          ],
          intent,
          { tray: 'Waiting', billEnergy: false, delegateToEngine: true }
        );
      }
      return verdict(
        'Unavailable',
        [
          'Idle detection unsupported or unreliable — manual pause; not assuming idle'
        ],
        intent,
        { tray: 'Waiting', billEnergy: false }
      );
    }

    const idleMs = /** @type {number} */ (input.idleMs);
    if (idleMs < cfg.idleMineAfterMs) {
      return verdict(
        'Paused',
        [`User active (idle ${idleMs}ms < ${cfg.idleMineAfterMs}ms)`],
        intent,
        { tray: 'Paused', billEnergy: false }
      );
    }
  }

  // Autostart gates (launch path)
  if (event.kind === 'login-launch') {
    if (!cfg.loginAutostart) {
      return verdict('Stopped', ['Login autostart not opted in'], intent, {
        tray: 'Stopped',
        billEnergy: false
      });
    }
    if (!cfg.resumeLastSessionOnLaunch) {
      return verdict(
        'Waiting',
        ['Login autostart on but resume-last-session not opted in'],
        intent,
        { tray: 'Waiting', billEnergy: false }
      );
    }
  }

  return verdict(
    'Mining',
    reasons.length ? reasons : ['Idle / power gates passed'],
    intent,
    { tray: 'Mining', billEnergy: true }
  );
}

function verdict(kind, reasons, intent, meta) {
  return {
    kind,
    reasons: [...reasons],
    intent: { ...intent },
    trayStatus: meta.tray,
    billEnergy: meta.billEnergy === true,
    releaseWake: meta.releaseWake === true,
    delegateToEngine: meta.delegateToEngine === true
  };
}

/**
 * Dry-run same predicate (never starts miner).
 */
export function simulate(input = {}) {
  return { ...evaluateDesktopIdle(input), simulated: true };
}
