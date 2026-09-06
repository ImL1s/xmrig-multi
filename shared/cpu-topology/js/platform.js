/**
 * Affinity capability matrix (#36).
 * Hard affinity = OS can bind threads to CPU ids.
 * Soft = QoS / priority hints only. Unsupported = do not pretend.
 */

/**
 * @param {string} [os]
 * @returns {{
 *   mode: 'hard'|'soft'|'unsupported',
 *   canBindCpuIds: boolean,
 *   canEmitXmrigAffinity: boolean,
 *   reasons: string[]
 * }}
 */
export function affinityCapability(os) {
    const platform = String(os || '').toLowerCase();
    if (platform === 'linux' || platform === 'windows') {
        return {
            mode: 'hard',
            canBindCpuIds: true,
            canEmitXmrigAffinity: true,
            reasons: [`${platform}: hard affinity via scheduler / XMRig cpu affinity`]
        };
    }
    if (platform === 'macos' || platform === 'darwin') {
        return {
            mode: 'soft',
            canBindCpuIds: false,
            canEmitXmrigAffinity: false,
            reasons: ['macOS: no portable hard affinity; QoS hints only — do not emit fake binds']
        };
    }
    if (platform === 'android' || platform === 'ios') {
        return {
            mode: 'soft',
            canBindCpuIds: false,
            canEmitXmrigAffinity: false,
            reasons: [`${platform}: scheduler/QoS only; hard affinity unsupported without privileged APIs`]
        };
    }
    if (platform === 'web' || platform === 'browser') {
        return {
            mode: 'unsupported',
            canBindCpuIds: false,
            canEmitXmrigAffinity: false,
            reasons: ['browser: no CPU affinity API']
        };
    }
    return {
        mode: 'unsupported',
        canBindCpuIds: false,
        canEmitXmrigAffinity: false,
        reasons: [`unknown OS "${os || ''}": treat affinity as unsupported`]
    };
}
