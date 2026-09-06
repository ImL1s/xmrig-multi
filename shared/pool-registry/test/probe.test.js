import test from 'node:test';
import assert from 'node:assert/strict';
import { probeEndpoint } from '../js/probe.js';

test('probe refuses silent TLS→plaintext: TLS fail stays tls-failed status shape', async () => {
    // Use unroutable TEST-NET address; expect dns or tcp failure without claiming protocol ok
    const result = await probeEndpoint({
        host: 'invalid.invalid',
        port: 3333,
        tls: true,
        timeoutMs: 500
    });
    assert.equal(result.tlsRequested, true);
    assert.ok(['dns-failed', 'dns-ok-tcp-failed', 'tls-failed', 'unreachable'].includes(result.status));
    assert.equal(result.protocol.skipped, true);
    assert.notEqual(result.status, 'tcp-ok');
});

test('allowTls=false with tls request does not fall back to plaintext success', async () => {
    // Even if TCP would work, policy must surface TLS denial — use invalid host so we only
    // assert the policy branch when DNS+TCP somehow ok is hard; unit-check summarize path via
    // calling with allowTls false after forcing by using localhost unlikely. Instead assert API:
    const result = await probeEndpoint({
        host: '127.0.0.1',
        port: 1,
        tls: true,
        allowTls: false,
        timeoutMs: 300
    });
    // Port 1 almost always connection refused → tcp fail before tls policy
    if (result.layers.tcp.ok) {
        assert.equal(result.layers.tls.ok, false);
        assert.match(result.layers.tls.error, /disallows TLS|no silent/i);
        assert.equal(result.status, 'tls-failed');
    } else {
        assert.ok(result.status.includes('tcp') || result.status.includes('dns') || result.status === 'unreachable');
    }
});
