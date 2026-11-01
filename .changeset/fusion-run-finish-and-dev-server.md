---
"@agent-native/core": patch
---

`sendFusionBranchMessage` now reports a run as completed only when the app agent's last turn ended the run. A `done` event marked `autoContinue` is followed by more turns, so a stream that ends after one is reported as unconfirmed rather than finished. Add `isFusionDevServerServing(previewUrl)`, which tells whether a branch's dev server is serving pages. A container `ensureFusionContainer` reports as ready can still be starting its dev server.
