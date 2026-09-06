/**
 * A11y helper tests (#58).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    VIEWPORTS,
    layoutClassForWidth,
    contrastRatio,
    checkUiSnapshot
} from '../js/checks.js';

test('viewport matrix covers compact/medium/expanded samples', () => {
    assert.ok(VIEWPORTS.length >= 7);
    assert.ok(VIEWPORTS.some((v) => v.width === 320));
    assert.ok(VIEWPORTS.some((v) => v.width === 1920));
    assert.equal(layoutClassForWidth(360), 'compact');
    assert.equal(layoutClassForWidth(600), 'medium');
    assert.equal(layoutClassForWidth(900), 'expanded');
});

test('Kiln ink on paper meets AA contrast', () => {
    // Approximate tokens from docs/design-system.md
    const ratio = contrastRatio('#1a1a1a', '#f7f4ef');
    assert.ok(ratio >= 4.5, ratio);
});

test('checkUiSnapshot flags color-only status and overflow', () => {
    const bad = checkUiSnapshot({
        width: 320,
        horizontalOverflow: true,
        statusColorOnly: true,
        interactive: [{ name: '', minTargetCssPx: 20 }]
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some((i) => i.code === 'overflow_x'));
    assert.ok(bad.issues.some((i) => i.code === 'color_only'));

    const good = checkUiSnapshot({
        width: 412,
        fontScale: 2,
        truncatedAt200pct: false,
        statusColorOnly: false,
        contrastPairs: [{ name: 'body', fg: '#1a1a1a', bg: '#f7f4ef' }],
        interactive: [{ name: 'Start', ariaLabel: 'Start mining', minTargetCssPx: 44 }]
    });
    assert.equal(good.ok, true);
    assert.ok(good.residual.length >= 1);
});
