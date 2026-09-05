/**
 * XMRig Multi Web - Mining Worker
 * Performs real RandomX hashing in a background thread.
 */

import { randomx_create_vm } from './lib/randomx.js';

let randomxNode = null;
let currentJob = null;
let isMining = false;

self.onmessage = async (e) => {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            // data is cache handle
            try {
                if (!data) throw new Error("Data is null");
                randomxNode = randomx_create_vm(data);
                self.postMessage({ type: 'initialized' });
            } catch (err) {
                self.postMessage({ type: 'error', message: 'Failed to create RandomX VM: ' + err.message + ' stack: ' + err.stack });
            }
            break;

        case 'job':
            // data is job object { blob, target, job_id }
            currentJob = data;
            isMining = true;
            startMining();
            break;

        case 'stop':
            isMining = false;
            break;

        case 'pause':
            isMining = false;
            break;

        case 'resume':
            isMining = true;
            startMining();
            break;
    }
};

function startMining() {
    if (!randomxNode || !currentJob || !isMining) return;

    const { blob, target, job_id } = currentJob;

    try {
        const blobBuffer = hexToUint8Array(blob);
        // target is hex string

        let nonce = Math.floor(Math.random() * 0xFFFFFFFF);
        let hashesDone = 0;
        const batchSize = 1;

        const runBatch = () => {
            if (!isMining || currentJob.job_id !== job_id) return;

            try {
                for (let i = 0; i < batchSize; i++) {
                    const currentNonce = (nonce + i) % 0xFFFFFFFF;
                    const workBlob = new Uint8Array(blobBuffer);
                    const view = new DataView(workBlob.buffer);
                    view.setUint32(39, currentNonce, true);

                    const result = randomxNode.calculate_hash(workBlob);
                    hashesDone++;

                    if (checkDifficulty(result, target)) {
                        self.postMessage({
                            type: 'result',
                            job_id: job_id,
                            nonce: uint32ToHex(currentNonce),
                            result: uint8ArrayToHex(result)
                        });
                    }
                }
                nonce += batchSize;

                if (hashesDone >= 5) {
                    self.postMessage({ type: 'hashrate', count: hashesDone });
                    hashesDone = 0;
                }

                setTimeout(runBatch, 0);
            } catch (err) {
                self.postMessage({ type: 'error', message: 'Error in runBatch: ' + err.message });
            }
        };

        runBatch();
    } catch (err) {
        self.postMessage({ type: 'error', message: 'Error in startMining: ' + err.message });
    }
}

/**
 * Check if the hash meets the difficulty target
 * @param {Uint8Array} hash - The RandomX hash result (32 bytes)
 * @param {string} targetHex - The target as hex string (4 or 64 chars)
 * @returns {boolean} - True if hash beats the target (valid share)
 */
function checkDifficulty(hash, targetHex) {
    // Convert hash to hex (reversed for big-endian comparison)
    // Use slice() to avoid mutating the original array
    const hashHex = uint8ArrayToHex(hash.slice().reverse());

    // Normalize target to 64-char big-endian hex string
    let target;
    if (targetHex.length === 8) {
        // 4-byte compact target (little endian) - convert to full 32-byte
        target = padTarget(targetHex);
    } else if (targetHex.length === 64) {
        target = targetHex.toLowerCase();
    } else {
        // Fallback: normalize to 64 hex chars by left-padding
        target = targetHex.toLowerCase().padStart(64, '0');
    }

    // Lexicographic comparison works for big-endian hex strings
    return hashHex <= target;
}

/**
 * Convert 4-byte compact target (little endian) to 32-byte big-endian target
 * @param {string} compactTargetHex - 8-char hex string (little endian 32-bit)
 * @returns {string} - 64-char hex string (big-endian 256-bit)
 */
function padTarget(compactTargetHex) {
    const hex = compactTargetHex.toLowerCase().padStart(8, '0');

    // Parse as little-endian 32-bit value
    const bytes = hexToUint8Array(hex);
    const view = new DataView(bytes.buffer);
    const value = view.getUint32(0, true); // little endian

    // Convert to big-endian hex and pad to 64 chars
    const beHex = value.toString(16).padStart(8, '0');
    return beHex.padStart(64, '0');
}

// Helpers
function hexToUint8Array(hex) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return arr;
}

function uint8ArrayToHex(arr) {
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function uint32ToHex(n) {
    const b = new Uint8Array(4);
    const v = new DataView(b.buffer);
    v.setUint32(0, n, true); // Little endian
    return uint8ArrayToHex(b);
}
