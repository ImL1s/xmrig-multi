/**
 * GPU capability evaluator (#65 phase 1 — visibility).
 */

/**
 * @typedef {'supported'|'experimental'|'unavailable'|'unverified'} GpuStatus
 * @typedef {'opencl'|'cuda'|'metal'|'webgpu'|'unknown'} GpuBackend
 *
 * @typedef {object} GpuDevice
 * @property {string} id
 * @property {string} [name]
 * @property {'integrated'|'discrete'|'unknown'} [kind]
 * @property {number|null} [vramMb]
 * @property {GpuBackend[]} backends
 * @property {GpuStatus} status
 * @property {string} reason
 * @property {boolean} startable
 *
 * @typedef {object} GpuSnapshot
 * @property {string} platform
 * @property {GpuDevice[]} devices
 * @property {{ opencl: boolean, cuda: boolean, metal: boolean, webgpu: boolean }} packagedBackends
 * @property {boolean} cpuMiningAvailable
 * @property {string[]} notes
 */

const UNSUPPORTED_PLATFORMS = new Set(['android', 'ios', 'web', 'wearos', 'watchos']);

/**
 * @param {object} raw
 * @returns {{ snapshot: GpuSnapshot, startableDevices: GpuDevice[], cpuFallback: { ok: boolean, reason: string } }}
 */
export function evaluateGpu(raw = {}) {
    const platform = String(raw.platform || 'desktop').toLowerCase();
    const packaged = {
        opencl: Boolean(raw.packagedBackends?.opencl),
        cuda: Boolean(raw.packagedBackends?.cuda),
        metal: Boolean(raw.packagedBackends?.metal),
        webgpu: Boolean(raw.packagedBackends?.webgpu)
    };

    const notes = [...(raw.notes || [])];
    let devices = Array.isArray(raw.devices) ? raw.devices.map((d) => normalizeDevice(d, packaged, platform)) : [];

    if (UNSUPPORTED_PLATFORMS.has(platform)) {
        devices = devices.map((d) => ({
            ...d,
            status: 'unavailable',
            startable: false,
            reason: d.reason || `No verified ${platform} GPU mining adapter (not OpenCL/CUDA by rename)`
        }));
        notes.push(`Platform ${platform}: GPU mining unavailable`);
    }

    // Plugin / driver failure fixtures
    if (raw.pluginMissing) {
        devices = devices.map((d) => ({
            ...d,
            status: 'unavailable',
            startable: false,
            reason: 'CUDA/OpenCL plugin missing'
        }));
    }
    if (raw.pluginWrongHash) {
        devices = devices.map((d) => ({
            ...d,
            status: 'unavailable',
            startable: false,
            reason: 'Plugin hash mismatch — refuse load'
        }));
    }
    if (raw.pluginWrongAbi) {
        devices = devices.map((d) => ({
            ...d,
            status: 'unavailable',
            startable: false,
            reason: 'Plugin ABI incompatible with packaged XMRig'
        }));
    }
    if (raw.driverMissing) {
        devices = devices.map((d) => ({
            ...d,
            status: 'unavailable',
            startable: false,
            reason: 'GPU driver missing or not detectable'
        }));
    }

    // Packaged backends off → never startable even if hardware present
    if (!packaged.opencl && !packaged.cuda && !packaged.metal && !packaged.webgpu) {
        devices = devices.map((d) => {
            if (d.startable) {
                return {
                    ...d,
                    status: d.status === 'supported' ? 'unavailable' : d.status,
                    startable: false,
                    reason: d.reason || 'Packaged miner built with GPU backends disabled'
                };
            }
            if (!d.reason) {
                return { ...d, reason: 'Packaged miner built with GPU backends disabled' };
            }
            return d;
        });
        notes.push('Packaged WITH_OPENCL/CUDA=OFF — hardware presence ≠ startable');
    }

    const startableDevices = devices.filter((d) => d.startable);
    const cpuMiningAvailable = raw.cpuMiningAvailable !== false;

    return {
        snapshot: {
            platform,
            devices,
            packagedBackends: packaged,
            cpuMiningAvailable,
            notes
        },
        startableDevices,
        cpuFallback: {
            ok: cpuMiningAvailable,
            reason: cpuMiningAvailable
                ? 'CPU mining remains available regardless of GPU'
                : 'CPU mining also unavailable'
        }
    };
}

function normalizeDevice(d, packaged, platform) {
    const backends = Array.isArray(d.backends) ? d.backends.map((b) => String(b).toLowerCase()) : [];
    let status = d.status || 'unverified';
    let reason = d.reason || '';
    let startable = false;

    if (d.vramInsufficient || (d.vramMb != null && d.vramMb >= 0 && d.minVramMb != null && d.vramMb < d.minVramMb)) {
        status = 'unavailable';
        reason = reason || `VRAM ${d.vramMb}MB < required ${d.minVramMb}MB`;
        startable = false;
    } else if (status === 'supported') {
        const backendOk = backends.some((b) => packaged[b] === true);
        if (!backendOk) {
            status = 'unavailable';
            reason = reason || 'No packaged backend matches device';
            startable = false;
        } else {
            // Phase 1: even "supported" hardware is not startable without selftest (phase 2)
            startable = d.selftestPassed === true && d.startable !== false;
            if (!startable) {
                status = d.selftestPassed === true ? 'supported' : 'unverified';
                reason = reason || (d.selftestPassed === true
                    ? 'Backend ready'
                    : 'Awaiting backend selftest / known-answer (phase 2)');
            }
        }
    } else if (status === 'experimental') {
        startable = false;
        reason = reason || 'Experimental — not auto-enabled';
    } else if (status === 'unavailable') {
        startable = false;
        reason = reason || 'Unavailable';
    } else {
        status = 'unverified';
        startable = false;
        reason = reason || 'Unverified — no evidence for this OS/driver/GPU/engine combo';
    }

    // Never claim Metal as OpenCL/CUDA
    if (platform === 'ios' || backends.includes('metal')) {
        if (backends.some((b) => b === 'opencl' || b === 'cuda')) {
            reason = 'Do not relabel Metal/mobile GPU as OpenCL/CUDA';
            status = 'unavailable';
            startable = false;
        }
    }

    return {
        id: String(d.id || 'gpu0'),
        name: d.name || d.id || 'GPU',
        kind: d.kind || 'unknown',
        vramMb: d.vramMb ?? null,
        backends,
        status,
        reason,
        startable: Boolean(startable)
    };
}
