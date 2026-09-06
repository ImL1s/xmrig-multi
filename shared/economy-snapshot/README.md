# Economy snapshot (#72)

Separates expected gross, pool-credited, paid, and market valuation — never double-count paid⊂credited or shared wallets.

## Rules

- `paid` is not additional to `credited`; net accounting uses one layer at a time.
- Same wallet across devices: pool balance counted once.
- Unknown revenue stays null — never invent 0 profit when cost known.
- Fee deducted once per #63; do not re-deduct pool-already-net balances.
- Fiat display carries rate source + timestamp; native amounts stay precise.

## API

```js
import { buildEconomySnapshot, AccrualLedger } from './js/economy.js';
```
