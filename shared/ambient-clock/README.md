# Ambient clock (#74)

Pure clock / clock+mining glance / remote watch modes with low update rate and night dimming.

## Rules

- Pure clock needs no wallet, miner, or network.
- Wall clock follows system timezone; session elapsed uses monotonic time.
- Default: no seconds, no 60fps redraw — minute ticks only.
- Night dim affects only this window; restore on exit.
- Never claim zero power or hardware AOD.

## API

```js
import { resolveAmbientMode, nextTickMs, nightDimFactor, formatWallClock } from './js/ambient.js';
```
