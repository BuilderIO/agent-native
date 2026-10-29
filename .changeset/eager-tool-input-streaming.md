---
"@agent-native/core": minor
---

Add an `eagerInputStreaming` option to `defineAction`. Actions that set it are sent to Anthropic models with `eager_input_streaming: true`, so their tool input streams as the model writes it instead of arriving one complete argument at a time. Use it for actions whose input is a large payload the UI renders progressively. Streamed input can be invalid JSON when a response is cut off.
