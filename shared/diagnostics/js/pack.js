/**
 * Diagnostic pack preview/export (#55). Never auto-uploads.
 */

import { redactValue } from './redact.js';

/**
 * @param {object} opts
 * @param {any[]} [opts.events]
 * @param {any[]} [opts.sessions]
 * @param {object} [opts.meta]
 * @param {{ from?: number, to?: number, maxEvents?: number }} [opts.range]
 */
export function buildDiagnosticPack(opts = {}) {
    const maxEvents = Math.min(opts.range?.maxEvents ?? 5000, 20_000);
    const events = (opts.events || []).slice(-maxEvents);
    const sessions = (opts.sessions || []).slice(-200);
    const preview = {
        schemaVersion: 1,
        packKind: 'diagnostics',
        redacted: true,
        autoUpload: false,
        generatedAt: new Date().toISOString(),
        meta: redactValue(opts.meta || {}),
        eventCount: events.length,
        sessionCount: sessions.length,
        rangeNote: opts.range
            ? `maxEvents=${maxEvents}`
            : 'tail of ring buffer',
        sample: redactValue(events.slice(0, 3))
    };
    const payload = {
        ...preview,
        events: redactValue(events),
        sessions: redactValue(sessions)
    };
    return { preview, payload };
}
