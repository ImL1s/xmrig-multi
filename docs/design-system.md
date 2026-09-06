# Kiln — the XMRig Multi design system

This is the shared visual and language system for the Android, Web and Desktop clients. It exists
because the three clients had drifted into three different products: Android was a flat list of
identical rows, Web was a fake dashboard, and Desktop was a purple gradient template.

The audit that motivated it is at the end of this file.

## What we are building

A miner is an instrument. The person using it wants to know three things, in this order:

1. Is it running?
2. How fast, and is that number real?
3. What do I change to make it better?

Everything else is subordinate. The system is therefore closer to a bench instrument or an ops
console than to a product landing page: dense where the numbers are, quiet everywhere else, and
never decorated in a way that implies confidence the software does not have.

Explicitly rejected: purple/blue gradients, gradient text, glow effects, marketing hero sections,
"cards" used as decoration, and any treatment that makes a stopped miner look active.

## Colour

The palette is named after a kiln: near-black grounds, a single hot ember accent, and cool
instrument colours for state. The ember is the brand. It is used for the primary action and the
product mark, and almost nowhere else, so that it keeps meaning "this is the thing to press".

| Role | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `ground` | `#0E0D0C` | `#F5F1E9` | Window background |
| `surface` | `#171614` | `#FDFBF6` | Panel |
| `surface-raised` | `#201E1B` | `#FFFFFF` | Readout tile inside a panel |
| `surface-inset` | `#0A0908` | `#EFEAE0` | Input wells, log, hero readout |
| `hairline` | `#322E2A` | `#DFD7C9` | Borders; 1px, never a shadow |
| `ink` / `ink-dim` / `ink-faint` | `#F2EDE4` / `#A8A093` / `#8A8276` | `#1A1613` / `#4E463C` / `#6E675D` | Text ramp |
| `ember` | `#E8722A` | `#A8501C` | Brand, primary action |
| `signal` | `#6FD3C7` | `#0C6F63` | Running, accepted, healthy |
| `caution` | `#E3B341` | `#7A5600` | Degraded, estimated, throttled |
| `halt` | `#E5534B` | `#B3261E` | Stopped by error, rejected, invalid |
| `inert` | `#8A8276` | `#6E675D` | Idle, unavailable, not applicable |

Android and Web ship both themes and follow the system setting. Desktop is dark-only for now: it
is a single fixed window and the light ramp has not been checked there.

`signal` / `caution` / `halt` / `inert` are the semantic set. They are *never* the only carrier of
meaning: every state that uses them also carries a word (`Mining`, `Stopped`, `Unavailable`) and,
where useful, a shape. This is the #58 requirement and it is also just correct — roughly 1 in 12
men cannot separate the ember from the halt red.

All foreground/background pairs in both themes meet WCAG 2.2 AA (4.5:1 for body text, 3:1 for
large text and UI boundaries).

Dynamic colour (Material You) is deliberately **off** on Android. A miner whose "running" colour
is derived from the user's wallpaper cannot promise that green means healthy.

## Type

Two families, with one job each.

- **Prose** — the platform's humanist UI face (`Segoe UI Variable Text` on Windows,
  `FontFamily.Default` on Android, with CJK fallbacks). Labels, hints, explanations.
- **Readout** — monospace (`Cascadia Mono`, `SFMono-Regular`, `JetBrains Mono`, …). Every number
  that changes while you watch it: hashrate, shares, difficulty, uptime, addresses, log lines.

Monospace for live numbers is not a style choice. A proportional 4271.60 reflows on every tick and
the digits jitter; a tabular one does not, so your eye can hold position on the value.

Display type (the product mark, panel titles) is a condensed grotesque — `Bahnschrift` /
`DIN Alternate` / `Archivo Narrow` — set in uppercase with wide tracking. Panel titles are small,
0.72rem, tracked to 0.16em: they should be findable, not loud.

Notably absent: Inter and stock Roboto.

## Data honesty

This is the part of the system that is actually load-bearing, and it comes out of #54 and #31.

Every displayed metric carries a quality, not just a value:

| Quality | Means | Renders as |
| --- | --- | --- |
| `MEASURED` | The miner reported this | The number, full contrast |
| `ESTIMATED` | Derived or averaged, not directly observed | The number + an `est.` tag |
| `PENDING` | Running, but nothing reported yet | `–.–– H/s`, dimmed |
| `UNAVAILABLE` | This platform/build cannot know it | `—` + the reason |
| `STALE` | Last known value, feed has stopped | The number + a `stale` tag |

Rules that follow from this:

- **A value we do not have is never rendered as `0`.** A stopped miner shows `–.–– H/s`, not
  `0.00 H/s`. Zero is a measurement; a placeholder is not.
- **A real zero stays zero.** A running miner that has genuinely produced no accepted share shows
  `0`, because that is true and the user needs to see it.
- **Nothing animates unless it is being fed.** The web CPU bar that swept back and forth
  regardless of miner state (#54) is gone; the activity indicator is now driven by actual reported
  work, and reads `Idle` when there is none.
- **Capability limits are stated where the choice is made**, not discovered on failure. Wownero
  and DERO are labelled unavailable in the coin picker itself, with the reason and the issue
  number (#28, #27), and the start control is disabled before the click rather than after it.

The formatting logic is implemented twice, deliberately in parallel, and tested to agree:
`app/src/main/java/com/iml1s/xmrigminer/presentation/format/MetricDisplay.kt` and
`web/js/format.js`.

## Layout and spacing

4px base scale: 4, 8, 12, 16, 24, 32. Radii are small (3–7px) — this is an instrument, not a pill.
Borders are 1px hairlines; there are no drop shadows anywhere in the system, because a shadow on a
near-black ground is either invisible or a glow.

Targets are at least 40px on desktop and 48dp on Android/touch, per WCAG 2.2 target size.

Breakpoints are content-driven rather than device-driven: single column until the readout row has
room for three tiles, then a second column for configuration. Android does the same thing with
`BoxWithConstraints` against `Sizes.twoColumnBreakpoint`, so a tablet, an unfolded foldable and a
freeform window all get the two-column status page without asking what kind of device it is.

## Motion

One animation exists: a 2.4s opacity breathe on the running indicator. It is the only thing on
screen that moves on its own, which is what makes it readable as "alive".

Everything else is a 150ms colour or border transition on interaction. All of it is disabled under
`prefers-reduced-motion` / the Android equivalent.

## Where it lives

| Platform | Tokens |
| --- | --- |
| Android | `presentation/theme/Color.kt`, `Tokens.kt`, `Type.kt`, `Theme.kt` |
| Web | `web/css/style.css` `:root` |
| Desktop | `desktop/src/styles.css` `:root` |

The three token sets are kept in the same vocabulary and the same values. They are not
auto-generated from a single source — that is a reasonable future step, but three hand-kept files
with matching names is honest about the current size of the project.

---

## Audit: what was wrong (Sep 2026)

Recorded here because the PR that introduced this system is judged against it.

### Android (`MiningScreen.kt`)

- Status, hashrate, shares, pool, threads, CPU, temperature and battery were rendered as **eight
  visually identical rows**. Nothing indicated that hashrate matters more than worker name.
- Running state was signalled **by colour alone** on a small dot.
- CPU usage was shown as a percentage the app does not actually measure per-core (#31).
- Unknown values rendered as `0`, so an idle miner and a broken miner looked the same.
- Unsupported coins were selectable and only failed at start.
- Material You dynamic colour meant "healthy" could render as any hue.

### Web (`index.html`, `app.js`, `style.css`)

- The CPU usage bar was **animated from a timer, not from data** (#54) — it swept while the miner
  was stopped.
- Configuration was one long undifferentiated form; no indication of which fields were required to
  start.
- Errors were appended to a log at the bottom of the page, far from the field that caused them,
  and never associated with the input for assistive tech.
- Duplicate element IDs; emoji used as load-bearing iconography.
- No skip link, no live regions, several targets under 24px.

### Desktop (`styles.css`, `main.js`)

- Purple/violet gradient background, gradient-filled heading text, gradient buttons — the exact
  generic-template look the product should avoid.
- Stopped miner displayed `0.00` hashrate and `0 / 0` shares as though measured.
- Wallet errors went to the log only.
- Unsupported coins were plain, unmarked options in the picker.
