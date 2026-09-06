# Release capability manifest (#64)

Single source of truth for what each packaged platform actually ships.

- `supported` requires an `evidenceId` that maps to a harness command in `docs/harness.md`.
- GPU OpenCL/CUDA are **unavailable** on all current packages (`WITH_OPENCL/CUDA=OFF`).
- Docs/UI/build flags must not claim more than this manifest; CI fails on contradiction.

```js
import { loadManifest, assertConsistent, checklist } from './js/load.js';
```
