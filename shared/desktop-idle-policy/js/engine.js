/**
 * Map idle prefs → XMRig argv (#77). Never emit unsupported native flags.
 */

import { capabilityMatrix } from './matrix.js';

/**
 * @typedef {object} IdleEnginePrefs
 * @property {boolean} [pauseOnBattery]
 * @property {boolean|number|null} [pauseOnActive] true | false | idle seconds
 * @property {number|null} [idleMineAfterMs] app-layer idle threshold
 */

/**
 * @param {string} os
 * @param {IdleEnginePrefs} prefs
 */
export function planEngineFlags(os, prefs = {}) {
  const matrix = capabilityMatrix(os);
  /** @type {string[]} */
  const argv = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const degradations = [];

  if (prefs.pauseOnBattery) {
    if (matrix.pauseOnBattery.state === 'unsupported') {
      warnings.push('pause-on-battery unsupported on this OS');
    } else {
      argv.push('--pause-on-battery');
    }
  }

  const poa = prefs.pauseOnActive;
  if (poa === true || (typeof poa === 'number' && poa > 0)) {
    if (matrix.pauseOnActive.state === 'available') {
      if (poa === true) {
        argv.push('--pause-on-active=true');
      } else {
        const sec = Math.max(1, Math.floor(Number(poa)));
        argv.push(`--pause-on-active=${sec}`);
      }
    } else {
      degradations.push(
        'pause-on-active not native here — use app-layer idle timer or manual pause'
      );
      if (
        prefs.idleMineAfterMs == null &&
        matrix.idleTimer.state !== 'available' &&
        matrix.idleTimer.state !== 'app-layer'
      ) {
        warnings.push('no reliable idle source — manual pause required');
      }
    }
  }

  return {
    argv,
    warnings,
    degradations,
    matrix,
    coordinator: 'single' // app must not also auto-resume against engine pause
  };
}
