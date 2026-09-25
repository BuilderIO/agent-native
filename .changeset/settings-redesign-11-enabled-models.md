---
"@agent-native/core": minor
---

Each model provider now keeps the models its owner checked, and only checked models appear in the chat model picker and the default-model select. A selection is stored at the same scope as the provider's key: a member's personal key uses their own selection, and the organization's selection belongs to owners and admins. With nothing checked, a provider shows its recommended models as before.

- New actions: `get-provider-models` (read the selection per provider and scope, with the recommended models) and `manage-provider-models` (`set` or `reset`; `scope: "org"` needs an owner or admin and is refused with 403 otherwise). Organization changes are recorded in the organization audit trail.
- `manage-agent-engine` `list` reports each engine's `supportedModels` as the models the picker offers, plus `recommendedModels` and `modelSelection` (`default`, `selected`, or `unreadable`). `/_agent-native/agent-model-defaults` offers the organization's checked models.
- Connecting Builder.io no longer hides other providers' models: providers with their own key show next to the Builder.io models. Builder.io model groups are labeled with a "· Builder.io" suffix ("OpenAI · Builder.io") so they read apart from a group on the provider's own key. Groq, Mistral, and Cohere show once they have a key, and Ollama shows once its models are checked.
- A chat already on an unchecked model keeps running on it. When nothing picked a model and the engine's default is unchecked, chats use the first checked model.
- `MultiTabAssistantChat` builds its model list with the same loader as `useChatModels`, so it now also swaps in Ollama's installed models.
