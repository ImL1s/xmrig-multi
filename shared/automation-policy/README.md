# Automation policy (#73)

Single reducer for hobby budget / profit-only / hard safety / user Stop.

## Priority (highest first)

1. User Stop / revoke
2. OS start eligibility / hard safety (thermal, etc.)
3. Budget (spend / kWh / session)
4. Charge / idle / schedule
5. Economic goal (profit-only vs hobby)

## Rules

- Same negative estimate: hobby+budget may allow; profit-only forbids; both forbid on thermal/Stop.
- Stop is latched — cool-down/plug/midnight must not revive.
- `pause-until-next-plug` is separate re-auth, not Stop.
- Simulation uses same predicate; never starts miner.
- Unknown/expired cheap power ≠ free energy / already profitable.

## API

```js
import { evaluateAutomation, simulate } from './js/automation.js';
```
