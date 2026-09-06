/**
 * Close-window policy (#77). Never default to hide-and-mine.
 */

/** @typedef {'ask'|'quit-and-stop'|'minimize-to-tray'} ClosePreference */

export const CLOSE_PREFS = Object.freeze({
  ASK: /** @type {ClosePreference} */ ('ask'),
  QUIT_AND_STOP: /** @type {ClosePreference} */ ('quit-and-stop'),
  MINIMIZE_TO_TRAY: /** @type {ClosePreference} */ ('minimize-to-tray')
});

/**
 * @param {object} input
 * @param {ClosePreference|null|undefined} input.savedPreference
 * @param {boolean} [input.rememberChoice]
 * @param {ClosePreference} [input.userChoice] required when preference is ask / unset
 * @param {boolean} [input.sessionAuthorized] mining already explicitly authorized
 */
export function resolveCloseBehavior(input = {}) {
  const saved = normalizePref(input.savedPreference);
  let choice = saved;
  let prompt = false;

  if (saved === CLOSE_PREFS.ASK || saved == null) {
    prompt = true;
    const picked = normalizePref(input.userChoice);
    if (!picked || picked === CLOSE_PREFS.ASK) {
      return {
        action: 'prompt',
        stopMiner: false,
        hideToTray: false,
        nextPreference: CLOSE_PREFS.ASK,
        reasons: ['First close (or preference unset): ask quit vs tray — never default hide-and-mine']
      };
    }
    choice = picked;
  }

  if (choice === CLOSE_PREFS.QUIT_AND_STOP) {
    return {
      action: 'quit-and-stop',
      stopMiner: true,
      hideToTray: false,
      nextPreference: input.rememberChoice ? CLOSE_PREFS.QUIT_AND_STOP : saved || CLOSE_PREFS.ASK,
      reasons: ['Exit and stop all mining processes']
    };
  }

  if (choice === CLOSE_PREFS.MINIMIZE_TO_TRAY) {
    if (!input.sessionAuthorized) {
      return {
        action: 'quit-and-stop',
        stopMiner: true,
        hideToTray: false,
        nextPreference: input.rememberChoice ? CLOSE_PREFS.MINIMIZE_TO_TRAY : saved || CLOSE_PREFS.ASK,
        reasons: [
          'Tray continue refused — session not authorized; refusing silent background mining'
        ]
      };
    }
    return {
      action: 'minimize-to-tray',
      stopMiner: false,
      hideToTray: true,
      nextPreference: input.rememberChoice
        ? CLOSE_PREFS.MINIMIZE_TO_TRAY
        : saved || CLOSE_PREFS.ASK,
      reasons: ['Hide to tray and continue already-authorized work']
    };
  }

  return {
    action: 'prompt',
    stopMiner: false,
    hideToTray: false,
    nextPreference: CLOSE_PREFS.ASK,
    reasons: ['Unknown preference — prompt']
  };
}

/** @param {unknown} p @returns {ClosePreference|null} */
function normalizePref(p) {
  if (p === CLOSE_PREFS.ASK || p === CLOSE_PREFS.QUIT_AND_STOP || p === CLOSE_PREFS.MINIMIZE_TO_TRAY) {
    return p;
  }
  return null;
}
