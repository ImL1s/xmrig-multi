/**
 * Mirror of ios GlancePresentation (#132) for CI without Xcode.
 * syncQuality=live + osIsStale must never show LIVE / unlabeled H/s.
 */

export const LIVE_ACTIVITY_TTL_SEC = 90;

export function glancePresentation({
  status = 'mining',
  hashrateHs = 0,
  syncQuality = 'offline',
  lastUpdatedAtMs = 0,
  sessionId = null,
  osIsStale = false,
  nowMs = Date.now(),
  clockOnly = false,
  expectedSessionId = null,
  ttlSec = LIVE_ACTIVITY_TTL_SEC
} = {}) {
  if (clockOnly) {
    return {
      title: 'Clock',
      qualityLabel: 'CLOCK',
      hashrateText: null,
      compactHashrate: '—',
      isLive: false
    };
  }

  const sessionOk =
    !expectedSessionId || expectedSessionId === '' || sessionId === expectedSessionId;

  let withinTtl = false;
  if (lastUpdatedAtMs > 0) {
    const sampleSec = lastUpdatedAtMs / 1000;
    const nowSec = nowMs / 1000;
    if (sampleSec <= nowSec + 5) {
      const age = nowSec - sampleSec;
      withinTtl = age >= 0 && age < ttlSec;
    }
  }

  const isLive =
    !osIsStale && syncQuality === 'live' && withinTtl && sessionOk;

  const base =
    status === 'mining'
      ? 'Mining'
      : status === 'paused'
        ? 'Paused'
        : status === 'waiting'
          ? 'Waiting'
          : 'Stopped';

  let title;
  let qualityLabel;
  if (osIsStale) {
    title = `${base} · stale`;
    qualityLabel = 'STALE';
  } else if (isLive) {
    title = base;
    qualityLabel = 'LIVE';
  } else if (syncQuality === 'offline') {
    title = `${base} · offline`;
    qualityLabel = 'OFFLINE';
  } else {
    title = `${base} · snapshot`;
    // Never echo stored "live" when freshness gates failed (#132).
    qualityLabel = 'SNAPSHOT';
  }

  let hashrateText = null;
  let compactHashrate = '—';
  if (syncQuality === 'offline' && lastUpdatedAtMs <= 0) {
    hashrateText = null;
  } else if (isLive) {
    hashrateText = `${hashrateHs.toFixed(1)} H/s`;
    compactHashrate = String(Math.round(hashrateHs));
  } else if (hashrateHs > 0) {
    hashrateText = `${hashrateHs.toFixed(1)} H/s (not live)`;
    compactHashrate = '—';
  }

  return { title, qualityLabel, hashrateText, compactHashrate, isLive };
}
