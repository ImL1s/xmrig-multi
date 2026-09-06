/**
 * Pure helpers for desktop start payload (#131).
 * Changing a visible advanced control must change the invoke config.
 */

export function normalizeAffinityHex(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    return s;
}

/**
 * @param {object} ui
 * @param {object} [probe] — from get_optimize_matrix; never invent available from requested
 */
export function buildMiningInvokeConfig(ui, probe = {}) {
    const hugePagesRequested = Boolean(ui.hugePages);
    const hugePagesAvailable = probe?.huge_pages?.state === 'available';
    const numaAvailable = probe?.numa?.state === 'available';
    const affinity = normalizeAffinityHex(ui.cpuAffinity);

    return {
        pool_url: ui.poolUrl,
        wallet_address: ui.walletAddress,
        worker_name: ui.workerName || 'desktop',
        threads: Number(ui.threads) || 1,
        coin_type: ui.coinType || 'monero',
        algorithm: ui.algorithm || 'rx/0',
        randomx_mode: ui.randomxMode || 'auto',
        huge_pages: hugePagesRequested,
        // Probe only — requested true + probe false ⇒ effective false in Rust.
        huge_pages_available: hugePagesAvailable,
        numa: Boolean(ui.numa) && numaAvailable,
        yield_cpu: ui.yieldCpu !== false,
        cpu_affinity: affinity,
        cpu_ids: Array.isArray(ui.cpuIds) && ui.cpuIds.length ? ui.cpuIds : null,
        pause_on_battery: Boolean(ui.pauseOnBattery),
        pause_on_active_seconds: ui.pauseOnActiveSeconds ?? null
    };
}

/**
 * Diff for draft→apply UX while mining.
 * @returns {{ dirty: boolean, fields: string[] }}
 */
export function diffAdvancedDraft(applied, draft) {
    const keys = [
        'huge_pages',
        'numa',
        'yield_cpu',
        'cpu_affinity',
        'threads',
        'randomx_mode'
    ];
    const fields = [];
    for (const k of keys) {
        const a = applied?.[k] ?? null;
        const d = draft?.[k] ?? null;
        if (JSON.stringify(a) !== JSON.stringify(d)) fields.push(k);
    }
    return { dirty: fields.length > 0, fields };
}
