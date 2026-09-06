# i18n terminology (#59)

Shared status codes + unit formatting vocabulary. UI translates codes; raw stderr stays expandable.

| Code | en | zh-Hant |
|------|----|---------|
| connecting | Connecting | 正在連線 |
| initializing | Initializing | 正在初始化 |
| computing | Computing | 計算中 |
| waiting_share | Waiting for share | 等待 share |
| stopped | Stopped | 已停止 |
| paused_thermal | Paused — overheating | 因過熱暫停 |

Units: H/s, kH/s, MH/s, threads, °C, MiB/GiB. Unknown must never format as `0`.

```js
import { STATUS, formatHashrate, t } from './js/catalog.js';
```
