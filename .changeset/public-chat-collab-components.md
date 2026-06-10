---
"@agent-native/core": minor
---

Expose focused public client subpaths for custom chat, composer, conversation, collaboration, rich-editor, and resources UI composition.

Adds `@agent-native/core/client/chat`, `@agent-native/core/client/composer`, `@agent-native/core/client/conversation`, `@agent-native/core/client/collab`, `@agent-native/core/client/editor`, and `@agent-native/core/client/resources`, promotes the low-level `TiptapComposer` props/types through the composer surface, exports `dedupeCollabUsersByEmail`, and documents how to rebuild agent chat/sidebar, realtime presence, rich editor, and resources experiences from public pieces.
