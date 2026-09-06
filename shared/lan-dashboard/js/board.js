/**
 * Per-card board presentation (#80).
 */

import { classifySync } from '../../companion-sync/js/protocol.js';

export function presentDeviceCard(device = {}, nowMs = Date.now()) {
  const sync = classifySync({
    nowMs,
    lastSyncAtMs: device.lastUpdatedAtMs,
    paired: device.paired !== false,
    reachable: device.reachable !== false,
    staleAfterMs: device.staleAfterMs,
    sourceDeviceId: device.deviceId,
    sessionId: device.sessionId
  });

  const sessionMismatch =
    device.expectedSessionId != null &&
    device.sessionId != null &&
    String(device.expectedSessionId) !== String(device.sessionId);

  if (sessionMismatch) {
    return {
      deviceId: device.deviceId,
      title: 'Session changed',
      hashrateLabel: null,
      live: false,
      freshness: 'offline',
      note: 'Engine session replaced — previous H/s not live'
    };
  }

  const live = sync.showAsLive;
  const hs =
    device.hashrateHs != null && Number.isFinite(Number(device.hashrateHs))
      ? `${Number(device.hashrateHs).toFixed(1)} H/s${live ? '' : ' (not live)'}`
      : null;

  return {
    deviceId: device.deviceId,
    title: live ? device.status || 'Mining' : `${device.status || 'Unknown'} · snapshot`,
    hashrateLabel: sync.quality === 'offline' && !device.lastUpdatedAtMs ? null : hs,
    live,
    freshness: sync.quality,
    note: sync.label
  };
}
