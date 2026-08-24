---
"@agent-native/core": patch
---

Three fixes to per-round-trip generations. A tool the run's death interrupts is now associated with the call that requested it — the association is recorded when the tool starts, since an interrupted tool never reaches the completion path and used to hang under the trace root, missing from its generation's counts. A model call the provider failed is marked failed even though its stream bracket closes on the way out, so a provider error is no longer reported as a healthy call and a retry no longer leaves the failed attempt green. And a call that reported its tokens keeps them when a later call throws: usage was gated on the loop's aggregate return value, which never arrives on a throw, so every call that had succeeded lost its tokens and cost.
