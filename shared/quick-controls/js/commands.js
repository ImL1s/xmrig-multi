/**
 * Quick-control command protocol (#79).
 */

export const SCHEMA_VERSION = 1;
export const DEFAULT_TTL_MS = 60_000;

/** @typedef {'start_profile'|'stop_mining'|'pause_for'|'disable_automation'|'open_clock'} QuickOp */
/** @typedef {'accepted'|'rejected'|'expired'|'queued'|'completed'} QuickAck */

export const OPS = Object.freeze([
  'start_profile',
  'stop_mining',
  'pause_for',
  'disable_automation',
  'open_clock'
]);

/**
 * @param {object} partial
 */
export function buildQuickCommand(partial = {}) {
  const type = String(partial.type || '');
  if (!OPS.includes(type)) {
    throw new Error(`unsupported quick op: ${type}`);
  }
  const issuedAtMs = partial.issuedAtMs ?? Date.now();
  const ttl = Number(partial.ttlMs) > 0 ? Number(partial.ttlMs) : DEFAULT_TTL_MS;
  const cmd = {
    schemaVersion: SCHEMA_VERSION,
    commandId: String(
      partial.commandId || `qc-${issuedAtMs}-${Math.random().toString(36).slice(2, 8)}`
    ),
    type,
    profileId: partial.profileId != null ? String(partial.profileId) : null,
    sessionId: partial.sessionId != null ? String(partial.sessionId) : null,
    issuedAtMs,
    expiresAtMs: partial.expiresAtMs ?? issuedAtMs + ttl,
    pauseForMs:
      type === 'pause_for'
        ? Math.max(0, Number(partial.pauseForMs) || 0)
        : null,
    source: String(partial.source || 'in-app'),
    // Never accept address/argv replacements
    payload: sanitizePayload(partial.payload || {})
  };
  return cmd;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (/wallet|address|password|token|seed|argv|shell|binary/i.test(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {object} command
 * @param {object} ctx
 */
export function receiveQuickCommand(command = {}, ctx = {}) {
  const nowMs = ctx.nowMs ?? Date.now();
  if (!command?.commandId || !OPS.includes(command.type)) {
    return { ack: /** @type {QuickAck} */ ('rejected'), reason: 'Malformed or unknown op', apply: false };
  }
  if (ctx.authorized === false) {
    return { ack: 'rejected', reason: 'Entry not authorized / pairing revoked', apply: false };
  }
  if (command.expiresAtMs != null && command.expiresAtMs < nowMs) {
    return { ack: 'expired', reason: 'Command deadline passed', apply: false };
  }
  if (ctx.sessionId && command.sessionId && ctx.sessionId !== command.sessionId) {
    return { ack: 'rejected', reason: 'Session mismatch', apply: false };
  }
  if (command.type === 'start_profile') {
    if (ctx.userStopLatched) {
      return { ack: 'rejected', reason: 'Stop latched — Start ignored', apply: false };
    }
    if (ctx.osStartAllowed === false) {
      return { ack: 'rejected', reason: 'OS/background start not permitted — open app', apply: false };
    }
    if (ctx.missingProfile) {
      return { ack: 'rejected', reason: 'No profile selected', apply: false };
    }
  }
  if (command.type === 'pause_for') {
    if (ctx.userStopLatched) {
      return { ack: 'rejected', reason: 'Stop latched — pause cannot schedule resume', apply: false };
    }
    if (!command.pauseForMs || command.pauseForMs <= 0) {
      return { ack: 'rejected', reason: 'pause_for requires positive pauseForMs', apply: false };
    }
  }
  return { ack: 'accepted', reason: 'Accepted', apply: true };
}

/**
 * Idempotent order: newer stop_mining wins; duplicate commandId skipped.
 * @param {object[]} commands
 */
export function applyQuickCommandOrder(commands = []) {
  const seen = new Set();
  const ordered = [...commands]
    .filter((c) => c?.commandId)
    .sort((a, b) => (a.issuedAtMs || 0) - (b.issuedAtMs || 0));

  /** @type {object|null} */
  let effective = null;
  const skipped = [];

  for (const cmd of ordered) {
    if (seen.has(cmd.commandId)) {
      skipped.push({ ...cmd, skipReason: 'duplicate commandId' });
      continue;
    }
    seen.add(cmd.commandId);

    if (!effective) {
      effective = cmd;
      continue;
    }

    if (
      cmd.type === 'stop_mining' &&
      (cmd.issuedAtMs || 0) >= (effective.issuedAtMs || 0)
    ) {
      skipped.push({ ...effective, skipReason: 'superseded by newer Stop' });
      effective = cmd;
      continue;
    }

    if (
      effective.type === 'stop_mining' &&
      cmd.type === 'start_profile' &&
      (cmd.issuedAtMs || 0) <= (effective.issuedAtMs || 0)
    ) {
      skipped.push({ ...cmd, skipReason: 'older Start cannot override newer Stop' });
      continue;
    }

    if ((cmd.issuedAtMs || 0) >= (effective.issuedAtMs || 0)) {
      skipped.push({ ...effective, skipReason: 'superseded' });
      effective = cmd;
    } else {
      skipped.push({ ...cmd, skipReason: 'older than effective' });
    }
  }

  return { effective, skipped };
}

/**
 * Pause timer expiry must not resume after a newer Stop.
 */
export function mayResumeAfterPause(input = {}) {
  const pauseIssuedAtMs = Number(input.pauseIssuedAtMs) || 0;
  const stopRevisionAtPause = Number(input.stopRevisionAtPause) || 0;
  const currentStopRevision = Number(input.currentStopRevision) || 0;
  const nowMs = input.nowMs ?? Date.now();
  const resumeAtMs = Number(input.resumeAtMs) || 0;

  if (currentStopRevision > stopRevisionAtPause) {
    return { allow: false, reason: 'Stop latched after pause — resume cancelled' };
  }
  if (resumeAtMs > nowMs) {
    return { allow: false, reason: 'Pause still active' };
  }
  if (input.userStopLatched) {
    return { allow: false, reason: 'Stop latched' };
  }
  if (input.osStartAllowed === false || input.budgetBlocked || input.powerBlocked) {
    return { allow: false, reason: 'Safety/budget/OS re-check failed' };
  }
  return { allow: true, reason: 'Pause elapsed and gates clear', pauseIssuedAtMs };
}
