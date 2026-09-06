# GPU capability (#65)

## Phase 1 — visibility
Per-device status: `supported` | `experimental` | `unavailable` | `unverified`
Packaged builds ship `WITH_OPENCL=OFF` / `WITH_CUDA=OFF`.

## Phase 2 — optional enable gates
- Default: all GPUs **disabled** even when startable
- Explicit per-device preference; never auto-enable all
- `runBackendSelftest` requires selftest **and** local job/submit — load-only is insufficient
- `releaseGpuContext` on stop/failure
- No fabricated H/W without a trusted power sensor
- Apple Metal / Android / Web: unavailable (never relabeled as OpenCL/CUDA)

Real CUDA/OpenCL mining on hardware remains **unverified** until a packaged backend + device report exists.

```js
import { evaluateGpu } from './js/evaluate.js';
import { resolveGpuEnablement, runBackendSelftest } from './js/phase2.js';
```
