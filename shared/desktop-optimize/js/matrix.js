/**
 * Desktop optimize capability matrix (#37).
 * @typedef {'available'|'needs-privilege'|'unsupported'|'unverified'} CapState
 */

/**
 * @param {string} os
 * @returns {Record<string, { state: CapState, label: string, reasons: string[] }>}
 */
export function capabilityMatrix(os) {
    const platform = String(os || '').toLowerCase();
    const base = () => ({
        hugePages: {
            state: 'unverified',
            label: 'Huge pages',
            reasons: ['probe required']
        },
        pages1g: {
            state: 'unsupported',
            label: '1GB pages',
            reasons: ['Linux-only']
        },
        numa: {
            state: 'unverified',
            label: 'NUMA',
            reasons: ['probe required']
        },
        msr: {
            state: 'unsupported',
            label: 'MSR',
            reasons: ['requires privileged helper + explicit consent']
        },
        priority: {
            state: 'available',
            label: 'Process priority',
            reasons: ['user-level nice / priority class']
        },
        yield: {
            state: 'available',
            label: 'CPU yield',
            reasons: ['XMRig --cpu-no-yield toggle']
        }
    });

    if (platform === 'linux') {
        return {
            hugePages: {
                state: 'needs-privilege',
                label: 'Huge pages',
                reasons: ['may need sysctl vm.nr_hugepages or already reserved pages']
            },
            pages1g: {
                state: 'needs-privilege',
                label: '1GB pages',
                reasons: ['Linux hugepagesz=1G; boot/sysctl — never auto-change']
            },
            numa: {
                state: 'available',
                label: 'NUMA',
                reasons: ['libnuma / XMRig --numa when nodes > 1']
            },
            msr: {
                state: 'needs-privilege',
                label: 'MSR',
                reasons: ['msr module + root helper; record originals; restore on stop']
            },
            priority: {
                state: 'available',
                label: 'Process priority',
                reasons: ['nice without root for mild adjustments']
            },
            yield: {
                state: 'available',
                label: 'CPU yield',
                reasons: ['XMRig yield flag']
            }
        };
    }

    if (platform === 'windows') {
        return {
            hugePages: {
                state: 'needs-privilege',
                label: 'Large pages',
                reasons: ['SeLockMemoryPrivilege; never auto-grant']
            },
            pages1g: {
                state: 'unsupported',
                label: '1GB pages',
                reasons: ['Linux-only — do not show enable switch']
            },
            numa: {
                state: 'available',
                label: 'NUMA',
                reasons: ['Windows NUMA APIs when multi-node']
            },
            msr: {
                state: 'needs-privilege',
                label: 'MSR',
                reasons: ['WinRing0-class helper not bundled; consent + restore required if enabled later']
            },
            priority: {
                state: 'available',
                label: 'Process priority',
                reasons: ['SetPriorityClass; default NORMAL']
            },
            yield: {
                state: 'available',
                label: 'CPU yield',
                reasons: ['XMRig yield flag']
            }
        };
    }

    if (platform === 'macos' || platform === 'darwin') {
        return {
            hugePages: {
                state: 'unsupported',
                label: 'Huge pages',
                reasons: ['no portable userland huge-page enable for XMRig on macOS']
            },
            pages1g: {
                state: 'unsupported',
                label: '1GB pages',
                reasons: ['Linux-only']
            },
            numa: {
                state: 'unsupported',
                label: 'NUMA',
                reasons: ['Apple Silicon / macOS NUMA not exposed for miner bind']
            },
            msr: {
                state: 'unsupported',
                label: 'MSR',
                reasons: ['no supported MSR path']
            },
            priority: {
                state: 'available',
                label: 'Process priority',
                reasons: ['QoS / nice hints only']
            },
            yield: {
                state: 'available',
                label: 'CPU yield',
                reasons: ['XMRig yield flag']
            }
        };
    }

    const unsupported = base();
    for (const key of Object.keys(unsupported)) {
        unsupported[key] = {
            ...unsupported[key],
            state: 'unsupported',
            reasons: [`OS ${platform || 'unknown'} not a desktop optimize target`]
        };
    }
    return unsupported;
}

/**
 * UI should only offer enable toggles for available | needs-privilege.
 * needs-privilege still requires consent before any helper call.
 */
export function isToggleable(state) {
    return state === 'available' || state === 'needs-privilege';
}
