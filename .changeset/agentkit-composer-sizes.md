---
"@agent-native/toolkit": patch
---

- The composer has two sizes. On an empty chat, or inside an element marked `data-agentkit-composer-size="large"`, it uses 16px text, a two-line text area, a 16px inset and 28px corners. Docked in a thread or a side panel it keeps 14px text and now has 24px corners, concentric with the Send button. Controls keep their sizes in both.
- A `layoutVariant="hero"` composer reads the same sizes: large while it is the only thing on an empty chat or inside a large-size element, docked once the thread starts. Hero hosts such as Ask and chat pages no longer pair 28px corners with docked 14px text. The legacy hero tokens apply only outside both.
- The side panel composer uses the composer radius (24px docked) instead of a fixed 14px.
- `AppShellSkeleton` gains an `assistant-new` layout that centers the heading and a large composer, for routes that open on an empty chat.
- The new-chat placeholder reads "Ask anything" instead of repeating the "How can I help?" heading.
