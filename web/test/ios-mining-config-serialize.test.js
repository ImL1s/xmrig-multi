/**
 * Offline serialization checks for iOS MiningConfig.toJSON thread/priority mapping (#32).
 * Run: node --test test/ios-mining-config-serialize.test.js
 *
 * Mirrors the Swift buildCpuConfig rules without requiring Xcode on CI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const IOS_MAX_RECOMMENDED_THREADS = 2;

function buildCpuConfig({ threads, cpuPriority, activeProcessors }) {
    const priority = Math.max(0, Math.min(5, cpuPriority));
    const usesAuto = threads <= 0;
    const resolved = usesAuto ? 0 : Math.min(threads, IOS_MAX_RECOMMENDED_THREADS);
    const cpu = {
        enabled: true,
        priority,
        'huge-pages': false,
        'hw-aes': true,
        yield: true
    };
    if (usesAuto) {
        cpu['max-threads-hint'] = 5;
    } else {
        const cores = Math.max(1, activeProcessors);
        const hint = Math.max(1, Math.min(100, Math.round((resolved / cores) * 100)));
        cpu['max-threads-hint'] = hint;
        cpu['rx/0'] = Array(resolved).fill(-1);
    }
    return cpu;
}

test('#32 manual threads=1 writes priority and rx/0 length 1', () => {
    const cpu = buildCpuConfig({ threads: 1, cpuPriority: 3, activeProcessors: 6 });
    assert.equal(cpu.priority, 3);
    assert.equal(cpu['rx/0'].length, 1);
    assert.equal(cpu['max-threads-hint'], Math.round((1 / 6) * 100));
});

test('#32 threads=4 is capped to iosMaxRecommendedThreads=2', () => {
    const cpu = buildCpuConfig({ threads: 4, cpuPriority: 2, activeProcessors: 8 });
    assert.equal(cpu['rx/0'].length, 2);
});

test('#32 auto threads (0) uses max-threads-hint=5 without rx/0 array', () => {
    const cpu = buildCpuConfig({ threads: 0, cpuPriority: 2, activeProcessors: 8 });
    assert.equal(cpu['max-threads-hint'], 5);
    assert.equal(cpu['rx/0'], undefined);
});

test('#32 priority is clamped to 0..5', () => {
    assert.equal(buildCpuConfig({ threads: 1, cpuPriority: 99, activeProcessors: 4 }).priority, 5);
    assert.equal(buildCpuConfig({ threads: 1, cpuPriority: -3, activeProcessors: 4 }).priority, 0);
});
