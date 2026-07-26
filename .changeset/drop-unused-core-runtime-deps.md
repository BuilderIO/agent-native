---
"@agent-native/core": patch
---

Shrink what the framework installs and carries by removing code and dependencies
nothing could reach. No public entry point exported any of it, so the package's
export surface is unchanged.

- Dropped the `@floating-ui/dom` dependency, which has no reference in
  `packages/core` or `packages/toolkit`; positioning goes through the Radix
  primitives that already declare their own copy.
- Dropped the `@opentelemetry/sdk-trace-base` dependency.
  `observability/tracing.ts` documents that heavy `@opentelemetry/sdk-*`
  packages are deliberately kept out of the dependency list and resolves
  `@opentelemetry/api` as an optional dependency at runtime, so this entry
  contradicted the module it was added for.
- Deleted `client/extensions/agent-native-extension-runtime.ts`, the orphaned
  predecessor of `portable-extension`, which every live importer already used.
- Deleted the unreferenced `BackgroundAgentSection`, `BrowserSection`, and
  `MissingKeyCard` components, plus the dead `DemoModeIcon` and
  `VoiceTranscriptionIcon` helpers.
