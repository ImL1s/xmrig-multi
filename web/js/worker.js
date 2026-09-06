/**
 * XMRig Multi Web - Mining Worker
 * Performs real RandomX hashing in a background thread.
 */

import { randomx_create_vm } from './lib/randomx.js';
import { checkDifficulty, decodeCompactTarget } from './share-target.js';

let randomxNode = null;
let currentJob = null;
let isMining = false;

self.onmessage = async (e) => {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            try {
                if (!data) throw new Error("Data is null");
                randomxNode = randomx_create_vm(data);
                self.postMessage({ type: 'initialized' });
            } catch (err) {
                self.postMessage({ type: 'error', message: 'Failed to create RandomX VM: ' + err.message + ' stack: ' + err.stack });
            }
            break;

        case 'job':
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
        const targetCheck = decodeCompactTarget(target);
        if (!targetCheck.ok) {
            self.postMessage({
                type: 'error',
                message: 'Unsupported Stratum target: ' + targetCheck.error
            });
            isMining = false;
            return;
        }

        const blobBuffer = hexToUint8Array(blob);

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
    v.setUint32(0, n, true);
    return uint8ArrayToHex(b);
}
