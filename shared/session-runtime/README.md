# Session runtime ownership (#49)

Cross-platform helpers so poller / reaper / worker events only mutate the
session generation that spawned them.

- `js/ownership.js` — generation gate for stats updates and delayed clears
- `js/nonce.js` — unsigned 32-bit nonce stride + job-loop generation

Desktop wires the same rules in Rust (`desktop/src-tauri/src/miner.rs`).
Web workers bump a loop generation on each job/resume so duplicate `runBatch`
closures exit.
