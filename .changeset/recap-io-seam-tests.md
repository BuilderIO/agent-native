---
"@agent-native/core": patch
---

Add minimal DI seams to recap.ts I/O functions for test coverage: `fetchFn?` on `githubRequest`/`findExistingComment`/`upsertComment`, `fetchFn?`/`waitFn?` on `uploadRecapImage`, and `importPlaywright?` on `runShot`. Export the four previously-private functions so the new `recap.io.spec.ts` can exercise them. No behavior change — all seams default to the original implementation.
