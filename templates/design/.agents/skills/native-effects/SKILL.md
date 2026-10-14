---
name: native-effects
description: >-
  Use when applying, inspecting, editing, or exporting curated WebGPU effects in a Design inline HTML screen.
---

# Curated native effects

Tier 1 executes the 16 exact builtin versions returned by `get-shader` (`format: "native-v2"`). Saved custom native definitions remain readable but cannot be newly applied or revised in this release. Historical GLSL shaders use the separate `shader-fills` workflow.

Read the selected file with `get-shader` or `read-source-file`, keep its `versionHash`, and call `edit-native-shader` with `expectedVersionHash`. Use `apply-preset` for a listed recipe or `apply` for an exact definition ID and version. For a selected element without a stable authored `data-agent-native-node-id`, pass a unique same-file `targetSelector`; the action stamps its stable ID and applies the effect in one guarded write. Do not copy generated runtime scripts into source. Only one enabled native Layer can be newly applied per target; Fill and Backdrop use their own placements.

`set-instance`, `set-params`, `playback`, `duplicate`, `reorder`, and `remove` use the same action and current source hash. On a stale-source error, re-read before retrying. A CPU-valid action result does not prove a GPU frame; inspect the Design preview. PNG from the open editor captures its last committed native frame after `prepare-native-scene-export` pins the current file and viewport. External agents can call `get-native-render-contexts`, request a local foreground PNG with `request-native-local-export` and the exact source version, then poll `get-native-local-export`. After the editor claims the request, it captures the committed frame, stores an owner-scoped PNG attachment, and marks the request completed. `get-native-local-export` then returns a protected same-origin download URL and opaque attachment reference. A pending request or browser download initiation is not completion. `export-png` rejects enabled native effects rather than returning headless pixels without them. A source mismatch, missing frame, or unsupported definition is a failure, not a blank export.
