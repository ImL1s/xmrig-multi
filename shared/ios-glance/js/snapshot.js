/**
 * Glance snapshot + freshness (#78).
 */

import { classifySync } from '../../companion-sync/js/protocol.js';

export const APP_GROUP_SUITE = 'group.com.iml1s.xmrigminer';
export const DEFAULT_STALE_AFTER_MS = 90_000;

const FORBIDDEN = [
  'wallet',
  'walletAddress',
  'address',
  'seed',
  'spendKey',
  'viewKey',
  'password',
  'pass',
  'poolPassword',
  'apiToken',
  'token',
  'privateKey'
];

/**
 * Build a shareable glance snapshot. Strips secrets.
 * @param {object} partial
 */
export function buildGlanceSnapshot(partial = {}) {
  const nowMs = partial.nowMs ?? Date.now();
  const raw = {
    schemaVersion: 1,
    sourceDeviceId: partial.sourceDeviceId ? String(partial.sourceDeviceId).slice(0, 64) : null,
    sessionId: partial.sessionId != null ? String(partial.sessionId) : null,
    status: normalizeStatus(partial.status),
    hashrateHs: numberOrNull(partial.hashrateHs),
    lastUpdatedAtMs: numberOrNull(partial.lastUpdatedAtMs) ?? nowMs,
    todayKwh: numberOrNull(partial.todayKwh),
    todayCostFiat: numberOrNull(partial.todayCostFiat),
    currency: partial.currency ? String(partial.currency).slice(0, 8) : null,
    clockOnly: partial.clockOnly === true
  };
  return redactSnapshot(raw);
}

/**
 * @param {object} snap
 */
export function redactSnapshot(snap) {
  const out = { ...snap };
  for (const key of Object.keys(out)) {
    if (FORBIDDEN.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      delete out[key];
    }
  }
  return out;
}

/**
 * Classify freshness for UI (never show stale H/s as live).
 */
export function classifyGlanceFreshness(input = {}) {
  const sync = classifySync({
    nowMs: input.nowMs,
    lastSyncAtMs: input.lastUpdatedAtMs ?? input.lastSyncAtMs,
    paired: input.appPresent !== false,
    reachable: input.appPresent !== false && input.processAlive !== false,
    staleAfterMs: input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    sourceDeviceId: input.sourceDeviceId,
    sessionId: input.sessionId
  });

  const sessionMismatch =
    input.expectedSessionId != null &&
    input.sessionId != null &&
    String(input.expectedSessionId) !== String(input.sessionId);

  if (sessionMismatch) {
    return {
      ...sync,
      quality: 'offline',
      label: 'Session changed — previous hashrate is not live',
      showAsLive: false,
      showHashrate: false
    };
  }

  if (input.appTerminated === true || input.processAlive === false) {
    return {
      ...sync,
      quality: 'offline',
      label: 'App not running — glance is a snapshot, not live mining',
      showAsLive: false,
      showHashrate: sync.quality !== 'offline'
    };
  }

  return {
    ...sync,
    showHashrate: sync.showAsLive || sync.quality === 'stale',
    showAsLive: sync.showAsLive
  };
}

/**
 * Display model for widget / Live Activity.
 */
export function presentGlance(snap = {}, freshness = {}) {
  const clockOnly = snap.clockOnly === true;
  if (clockOnly) {
    return {
      title: 'Clock',
      subtitle: 'Miner glance off',
      hashrateLabel: null,
      statusLabel: null,
      freshnessLabel: freshness.label || null,
      claimLiveMining: false
    };
  }

  const status = snap.status || 'stopped';
  const live = freshness.showAsLive === true;
  const hashrateLabel =
    freshness.showHashrate && snap.hashrateHs != null
      ? `${formatHs(snap.hashrateHs)}${live ? '' : ' (not live)'}`
      : null;

  return {
    title: live ? statusTitle(status) : statusTitle(status) + ' · snapshot',
    subtitle: freshness.label || '',
    hashrateLabel,
    statusLabel: status,
    freshnessLabel: freshness.label || null,
    claimLiveMining: live && (status === 'mining' || status === 'paused')
  };
}

function statusTitle(status) {
  switch (String(status)) {
    case 'mining':
      return 'Mining';
    case 'paused':
      return 'Paused';
    case 'waiting':
      return 'Waiting';
    default:
      return 'Stopped';
  }
}

function normalizeStatus(s) {
  const v = String(s || 'stopped').toLowerCase();
  if (['mining', 'paused', 'waiting', 'stopped'].includes(v)) return v;
  return 'stopped';
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatHs(hs) {
  if (hs >= 1e6) return `${(hs / 1e6).toFixed(2)} MH/s`;
  if (hs >= 1e3) return `${(hs / 1e3).toFixed(1)} kH/s`;
  return `${hs.toFixed(1)} H/s`;
}
