/**
 * Read-only snapshot for tiles / widgets (#79).
 */

/**
 * @param {object} input
 */
export function buildQuickSnapshot(input = {}) {
  return {
    schemaVersion: 1,
    mining: Boolean(input.mining),
    automationArmed: Boolean(input.automationArmed),
    waitingReason: input.waitingReason ? String(input.waitingReason).slice(0, 120) : null,
    profileId: input.profileId != null ? String(input.profileId) : null,
    profileName: input.profileName ? String(input.profileName).slice(0, 64) : null,
    userStopLatched: Boolean(input.userStopLatched),
    pauseUntilMs: Number.isFinite(Number(input.pauseUntilMs)) ? Number(input.pauseUntilMs) : null,
    updatedAtMs: input.updatedAtMs ?? Date.now(),
    // Explicit labels for UI copy
    labels: {
      stopMining: 'Stop mining',
      disableAutomation: 'Disable automation',
      startProfile: 'Start selected profile',
      pause: 'Pause for a while'
    }
  };
}
