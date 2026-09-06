import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMiningInvokeConfig, diffAdvancedDraft } from '../src/launch-config.js';

test('advanced UI fields appear in invoke payload', () => {
    const probe = {
        huge_pages: { state: 'available' },
        numa: { state: 'available' }
    };
    const cfg = buildMiningInvokeConfig(
        {
            poolUrl: 'pool:3333',
            walletAddress: '4...',
            workerName: 'desk',
            threads: 4,
            coinType: 'monero',
            algorithm: 'rx/0',
            randomxMode: 'fast',
            hugePages: true,
            numa: true,
            yieldCpu: false,
            cpuAffinity: '0x3',
            pauseOnBattery: true,
            pauseOnActiveSeconds: 60
        },
        probe
    );
    assert.equal(cfg.huge_pages, true);
    assert.equal(cfg.huge_pages_available, true);
    assert.equal(cfg.numa, true);
    assert.equal(cfg.yield_cpu, false);
    assert.equal(cfg.cpu_affinity, '0x3');
    assert.equal(cfg.randomx_mode, 'fast');
});

test('requested hugepages does not invent available when probe unknown', () => {
    const cfg = buildMiningInvokeConfig(
        {
            poolUrl: 'p',
            walletAddress: 'w',
            threads: 2,
            hugePages: true,
            numa: true,
            yieldCpu: true
        },
        { huge_pages: { state: 'unknown' }, numa: { state: 'unavailable' } }
    );
    assert.equal(cfg.huge_pages, true);
    assert.equal(cfg.huge_pages_available, false);
    assert.equal(cfg.numa, false);
});

test('draft diff marks unsaved advanced changes', () => {
    const applied = { huge_pages: false, numa: false, yield_cpu: true, cpu_affinity: null, threads: 4, randomx_mode: 'auto' };
    const draft = { ...applied, huge_pages: true, cpu_affinity: '0x3' };
    const d = diffAdvancedDraft(applied, draft);
    assert.equal(d.dirty, true);
    assert.ok(d.fields.includes('huge_pages'));
    assert.ok(d.fields.includes('cpu_affinity'));
});

test('removing advanced fields from builder fails this contract', () => {
    const cfg = buildMiningInvokeConfig({
        poolUrl: 'p',
        walletAddress: 'w',
        threads: 1,
        hugePages: true,
        cpuAffinity: '0x1'
    }, { huge_pages: { state: 'available' } });
    assert.ok('huge_pages' in cfg);
    assert.ok('huge_pages_available' in cfg);
    assert.ok('cpu_affinity' in cfg);
    assert.ok('yield_cpu' in cfg);
    assert.ok('numa' in cfg);
});
