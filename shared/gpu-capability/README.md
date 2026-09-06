# GPU capability (#65 phase 1)

Visibility + fixtures only. Packaged builds ship `WITH_OPENCL=OFF` / `WITH_CUDA=OFF`.

- Per-device status: `supported` | `experimental` | `unavailable` | `unverified`
- `startable` only when status is `supported` **and** backend selftest would pass (phase 2)
- No GPU / unsupported platforms must not invent startable controls; CPU mining unaffected
- Apple Metal / Android / Web: explicit unavailable — never relabel as OpenCL/CUDA

```js
import { evaluateGpu, loadFixture } from './js/evaluate.js';
```
