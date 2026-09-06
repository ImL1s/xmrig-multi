/**
 * XMRig Multi Web - Mining Worker
 * Performs real RandomX hashing in a background thread.
 * Job generation isolates duplicate job/resume loops (#49).
 */

import { randomx_create_vm } from './lib/randomx.js';
import { checkDifficulty, decodeCompactTarget } from './share-target.js';

let randomxNode = null;
let currentJob = null;
let isMining = false;
/** Bumped on every job / stop so prior runBatch loops exit (#49). */
let jobGeneration = 0;

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
            jobGeneration += 1;
            currentJob = data;
            isMining = true;
            startMining(jobGeneration);
            break;

        case 'stop':
            jobGeneration += 1;
            isMining = false;
            currentJob = null;
            break;

        case 'pause':
            isMining = false;
            break;

        case 'resume':
            if (!currentJob) break;
            // Resume same job_id keeps generation; still start one loop tied to current gen.
            isMining = true;
            startMining(jobGeneration);
            break;
    }
};

function startMining(generation) {
    if (!randomxNode || !currentJob || !isMining) return;

    const { blob, target, job_id } = currentJob;
    const ownedGen = generation;

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

        // Full 32-bit unsigned space with correct wrap (#49).
        let nonce = Math.floor(Math.random() * 0x100000000) >>> 0;
        let hashesDone = 0;
        const batchSize = 1;

        const runBatch = () => {
            if (!isMining || jobGeneration !== ownedGen) return;
            if (!currentJob || currentJob.job_id !== job_id) return;

            try {
                for (let i = 0; i < batchSize; i++) {
                    const currentNonce = (nonce + i) >>> 0;
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
                nonce = (nonce + batchSize) >>> 0;

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
    return (n >>> 0).toString(16).padStart(8, '0');
}
