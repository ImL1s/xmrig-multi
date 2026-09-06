/**
 * LAN dashboard pairing (#80).
 */

export const SCHEMA_VERSION = 1;
export const DEFAULT_PAIR_TTL_MS = 120_000;

/**
 * Create a short-lived pairing challenge (miner host side).
 */
export function createPairingChallenge(input = {}) {
  const nowMs = input.nowMs ?? Date.now();
  const ttl = Number(input.ttlMs) > 0 ? Number(input.ttlMs) : DEFAULT_PAIR_TTL_MS;
  const code = String(input.code || randomCode());
  return {
    schemaVersion: SCHEMA_VERSION,
    pairId: String(input.pairId || `pair-${nowMs}`),
    code,
    hostDeviceId: String(input.hostDeviceId || ''),
    expiresAtMs: nowMs + ttl,
    createdAtMs: nowMs,
    used: false,
    revoked: false
  };
}

/**
 * Client completes pairing with code + host attestation.
 */
export function completePairing(challenge, attempt = {}) {
  const nowMs = attempt.nowMs ?? Date.now();
  if (!challenge || challenge.revoked) {
    return { ok: false, reason: 'Pairing revoked or missing' };
  }
  if (challenge.used) {
    return { ok: false, reason: 'Pairing code already used (replay)' };
  }
  if (challenge.expiresAtMs < nowMs) {
    return { ok: false, reason: 'Pairing code expired' };
  }
  if (String(attempt.code || '') !== challenge.code) {
    return { ok: false, reason: 'Invalid pairing code' };
  }
  if (!attempt.expectedHostDeviceId) {
    return { ok: false, reason: 'expectedHostDeviceId required' };
  }
  if (
    challenge.hostDeviceId &&
    challenge.hostDeviceId !== attempt.expectedHostDeviceId
  ) {
    return { ok: false, reason: 'Host device mismatch (wrong miner)' };
  }
  if (attempt.channelBound !== true) {
    return { ok: false, reason: 'Channel not authenticated / MITM risk' };
  }
  const clientId = String(attempt.clientDeviceId || `client-${nowMs}`);
  return {
    ok: true,
    reason: 'Paired',
    grant: {
      clientId,
      hostDeviceId: challenge.hostDeviceId,
      pairedAtMs: nowMs,
      role: 'readonly',
      tokenId: `tok-ro-${clientId}`,
      revocable: true
    },
    nextChallenge: { ...challenge, used: true }
  };
}

export function revokeClient(registry = {}, clientId) {
  const clients = { ...(registry.clients || {}) };
  if (!clients[clientId]) {
    return { ...registry, clients };
  }
  clients[clientId] = { ...clients[clientId], revoked: true, revokedAtMs: Date.now() };
  return { ...registry, clients };
}

export function isClientAuthorized(registry = {}, clientId, needRole = 'readonly') {
  const c = registry.clients?.[clientId];
  if (!c || c.revoked) return { ok: false, reason: 'Unauthorized or revoked' };
  if (needRole === 'control' && c.role !== 'control') {
    return { ok: false, reason: 'Read-only token cannot control' };
  }
  return { ok: true, reason: 'Authorized', client: c };
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
