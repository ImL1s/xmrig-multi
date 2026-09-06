# Onboarding flow (#56)

Three explicit steps before Start — never auto-mine on open / paste / ToS.

1. **Capability** — what this engine can mine (supported / limited / unknown)
2. **Payout** — coin, address, verified preset or custom endpoint
3. **Load** — quiet / efficiency / balanced / max sustained (or skip calibration)

Then a **launch summary** (engine, pool, elided address, threads, fees) and an explicit Start.

Draft ≠ running config. Back navigation keeps draft. Advanced settings always reachable via skip.

```js
import { createOnboarding, canStart } from './js/flow.js';
```
