---
"@agent-native/toolkit": patch
---

Allow embedded webviews inside Agent-Native Desktop (such as Analytics settings) to launch Builder.io OAuth authorization via `openBuilderConnectPopup` when no host `BuilderConnectTransport` is attached, refreshing expired signed connect URLs before opening while keeping desktop host renderers fail-closed when `transport.openConnectUrl` is missing.
