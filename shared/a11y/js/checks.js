/**
 * A11y acceptance helpers (#58) — automated slice only.
 */

export const VIEWPORTS = Object.freeze([
    { id: 'phone-320', width: 320, height: 640, class: 'compact' },
    { id: 'phone-360', width: 360, height: 740, class: 'compact' },
    { id: 'phone-412', width: 412, height: 915, class: 'compact' },
    { id: 'fold-inner', width: 600, height: 800, class: 'medium' },
    { id: 'tablet-840', width: 840, height: 1024, class: 'expanded' },
    { id: 'desktop-800x600', width: 800, height: 600, class: 'expanded' },
    { id: 'desktop-1920x1080', width: 1920, height: 1080, class: 'expanded' }
]);

export const BREAKPOINTS = Object.freeze({
    compactMax: 599,
    mediumMax: 839
});

export function layoutClassForWidth(width) {
    if (width <= BREAKPOINTS.compactMax) return 'compact';
    if (width <= BREAKPOINTS.mediumMax) return 'medium';
    return 'expanded';
}

/** Relative luminance helpers for WCAG contrast. */
export function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function relativeLuminance({ r, g, b }) {
    const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fgHex, bgHex) {
    const L1 = relativeLuminance(hexToRgb(fgHex));
    const L2 = relativeLuminance(hexToRgb(bgHex));
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @param {object} snapshot minimal UI tree for CI
 */
export function checkUiSnapshot(snapshot = {}) {
    const issues = [];
    const width = snapshot.width || 360;
    const fontScale = snapshot.fontScale || 1;
    const layout = layoutClassForWidth(width);

    if (snapshot.horizontalOverflow) {
        issues.push({ code: 'overflow_x', message: 'Horizontal overflow at viewport' });
    }
    if (snapshot.primaryActionsObscured) {
        issues.push({ code: 'controls_obscured', message: 'Start/Stop obscured by keyboard or inset' });
    }
    if (fontScale >= 2 && snapshot.truncatedAt200pct) {
        issues.push({ code: 'font_scale_clip', message: 'Critical controls clipped at 200% font' });
    }
    for (const pair of snapshot.contrastPairs || []) {
        const ratio = contrastRatio(pair.fg, pair.bg);
        const need = pair.largeText ? 3 : 4.5;
        if (ratio < need) {
            issues.push({
                code: 'contrast',
                message: `${pair.name}: ${ratio.toFixed(2)} < ${need}`
            });
        }
    }
    for (const el of snapshot.interactive || []) {
        if ((el.minTargetCssPx || 0) < 24) {
            issues.push({ code: 'target_size', message: `${el.name} target < 24px` });
        }
        if (!el.name && !el.ariaLabel) {
            issues.push({ code: 'name', message: 'Interactive element missing accessible name' });
        }
    }
    if (snapshot.statusColorOnly) {
        issues.push({ code: 'color_only', message: 'Status encoded by color alone' });
    }
    if (snapshot.focusOrderBroken) {
        issues.push({ code: 'focus_order', message: 'Keyboard focus order broken' });
    }

    return {
        ok: issues.length === 0,
        layout,
        width,
        fontScale,
        issues,
        residual: snapshot.manualResidual || [
            'TalkBack / VoiceOver flows unverified in CI',
            'Physical fold device unverified'
        ]
    };
}
