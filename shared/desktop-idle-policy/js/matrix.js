/**
 * Per-OS desktop idle / pause capability (#77).
 * XMRig documents pause-on-active for Windows/macOS only.
 * @see https://xmrig.com/docs/miner/config/misc
 */

export const SCHEMA_VERSION = 1;

/**
 * @typedef {'available'|'unsupported'|'needs-permission'|'app-layer'} CapState
 * @typedef {{ state: CapState, label: string, reasons: string[] }} CapField
 */

/**
 * @param {string} os
 */
export function capabilityMatrix(os) {
  const platform = String(os || '').toLowerCase();
  if (platform === 'windows') {
    return {
      os: 'windows',
      pauseOnActive: field('available', 'Pause on active', [
        'XMRig native pause-on-active (true or idle seconds)'
      ]),
      pauseOnBattery: field('available', 'Pause on battery', [
        'XMRig native pause-on-battery'
      ]),
      idleTimer: field('available', 'Idle timer', [
        'OS idle time API — no key content collection'
      ]),
      tray: field('available', 'System tray', ['Win32 notification area']),
      keepAwake: field('needs-permission', 'Keep awake', [
        'Explicit consent only; default respects sleep/lid'
      ])
    };
  }
  if (platform === 'macos' || platform === 'darwin') {
    return {
      os: 'macos',
      pauseOnActive: field('available', 'Pause on active', [
        'XMRig native pause-on-active on macOS'
      ]),
      pauseOnBattery: field('available', 'Pause on battery', [
        'XMRig native pause-on-battery'
      ]),
      idleTimer: field('available', 'Idle timer', [
        'IOKit idle time — no key content collection'
      ]),
      tray: field('available', 'Menu bar', ['NSStatusItem']),
      keepAwake: field('needs-permission', 'Keep awake', [
        'IOPMAssertion only with explicit consent'
      ])
    };
  }
  // linux / other — do not pretend native pause-on-active exists
  return {
    os: platform || 'linux',
    pauseOnActive: field('unsupported', 'Pause on active', [
      'XMRig pause-on-active is Windows/macOS only — use app-layer idle when available'
    ]),
    pauseOnBattery: field('available', 'Pause on battery', [
      'XMRig pause-on-battery when AC presence is known'
    ]),
    idleTimer: field('needs-permission', 'Idle timer', [
      'X11/Wayland idle may be unavailable — degrade to manual pause'
    ]),
    tray: field('available', 'System tray', ['StatusNotifierItem when desktop supports it']),
    keepAwake: field('needs-permission', 'Keep awake', [
      'Inhibit only with explicit consent; default respects sleep'
    ])
  };
}

/**
 * @param {CapState} state
 * @param {string} label
 * @param {string[]} reasons
 * @returns {CapField}
 */
function field(state, label, reasons) {
  return { state, label, reasons: [...reasons] };
}
