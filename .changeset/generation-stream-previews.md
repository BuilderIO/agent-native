---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Apps can now show content the agent is still writing. `@agent-native/core/client/generation-stream` follows a tool call's arguments while they stream (`useStreamingToolInput`, or `useStreamingToolInputs` for every call one response writes), parses incomplete JSON and HTML, and patches the preview in place. New elements are drafted the way a designer blocks out a layout: each nesting level's frames trace in, then the content fades in beneath them. The AgentKit chat now forwards streamed tool input to the page instead of dropping it. `@agent-native/toolkit/app/generation` adds `GeneratingFrame`, `GeneratingLabel`, and `StreamingHtmlFrame`, which hold the final size, outline the work in the selection color with a wash over the label, and show a failed call as failed rather than finished.
