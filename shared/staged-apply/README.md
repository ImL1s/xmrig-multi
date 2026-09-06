# Staged apply / advanced controls (#57)

Maps **requested → resolved → effective** for editable mining fields.

| Apply mode | Meaning |
|------------|---------|
| `hot` | Can apply while running without process restart |
| `restart` | Saved now; needs miner restart to become effective |
| `unsupported` | Must not appear as a working control |

Rules:
- Editing while running edits a **draft**; Apply shows a redacted diff + per-field mode.
- Failed apply rolls back to last-known-good **engine** state but keeps the user draft.
- Manual locks are not overwritten by tuner updates.
- Expert raw JSON/argv goes through allowlist + conflict checks — no shell concatenation.

```js
import { fieldCatalog, stageApply, validateExpertArgs } from './js/stage.js';
```
