# Migrate chat surfaces to AgentKit

This guide covers the Core 0.194.0 chat implementation change. Core's
assistant-ui transcript and stream owner moved to AgentKit. The familiar Core
chat shell components were not all deleted.

## What remains supported

| API                                                                                        | Status                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `AssistantChat` from `@agent-native/core/client/agent-chat`                                | Supported alias for `AgentKitAssistantChat`                        |
| `AgentKitAssistantChat`                                                                    | Supported direct name for the AgentKit-backed surface              |
| `AgentPanel`, `AgentSidebar`, `AgentChatSurface`, `AgentChatHome`, `MultiTabAssistantChat` | Supported shells and page surfaces                                 |
| App actions, SQL data, auth, access checks, and application state                          | Keep the existing app contracts unless the app itself changed them |

Most apps that mounted Core's chat shell can keep their current UI composition.
The `AssistantChat` name still works, but now renders the AgentKit-backed
implementation. New chat imports should use the canonical
`@agent-native/core/client/agent-chat` entrypoint.

The `@agent-native/core/client/chat` compatibility entry remains useful for a
small number of exports that have not moved, including
`createAgentKitProtocolAdapter()`. Keep using that entry for those exports; do
not rewrite every `/client/chat` import without checking the imported symbol.

## Removed APIs

| Old API                                                                                                                                                   | Migration                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssistantChat`'s `createAdapter` prop                                                                                                                    | Pass an `AgentChatRuntime` through `runtime`, pass an AgentKit `AgentTransport` through `createTransport`, or omit both to use Core's default transport.                                                        |
| `createAgentChatRuntimeAdapter`                                                                                                                           | Pass the existing `AgentChatRuntime` directly to `AssistantChat` or `AgentKitAssistantChat`.                                                                                                                    |
| `createAgentChatAdapter`                                                                                                                                  | Core's standard surface already owns its transport. For a custom backend, implement the AgentKit `AgentTransport` contract and pass it through `createTransport`.                                               |
| `createCodeAgentChatAdapter`, `codeAgentTranscriptEventsToContent`, and `codeAgentTranscriptHasPendingApproval`                                           | There is no generic drop-in replacement. Use an existing code-agent integration or adapt the backend to `AgentTransport`; keep one transcript and stream owner.                                                 |
| `CreateAgentChatAdapterOptions`, `CreateAgentChatRuntimeAdapterOptions`                                                                                   | No replacement for adapter-specific options. Pass `AgentChatRuntime` directly or implement an AgentKit `AgentTransport` through `createTransport`.                                                              |
| `CreateCodeAgentChatAdapterOptions`, `CodeAgentChatController`, `CodeAgentChatControlResult`, `CodeAgentChatFollowUpMode`, `CodeAgentChatTranscriptEvent` | No generic drop-in replacement. These belong to the removed code-agent adapter; integrate through `AgentTransport` or an existing code-agent integration, then model state through that integration's contract. |
| `AssistantMessageActionBar`                                                                                                                               | Customize AgentKit message actions through `slots.messageActions` or add trailing actions through `slots.messageActionsTrailing`.                                                                               |
| `AssistantMessageActionBarProps`                                                                                                                          | Use the props supplied by AgentKit's `slots.messageActions` and `slots.messageActionsTrailing` components. There is no compatibility prop type.                                                                 |
| `FormattedMessageTimestamp`                                                                                                                               | There is no Core replacement. Format timestamps in your app's message UI according to its locale and time policy.                                                                                               |
| assistant-ui transcript/runtime primitives used to own chat                                                                                               | Use AgentKit React components, slots, registries, and `useAgentKitControl()`. Keep assistant-ui imports inside the shared composer integration.                                                                 |

For a custom runtime, the supported Core surface accepts it directly:

```tsx
import {
  AssistantChat,
  type AgentChatRuntime,
} from "@agent-native/core/client/agent-chat";

export function SupportChat({ runtime }: { runtime: AgentChatRuntime }) {
  return <AssistantChat runtime={runtime} threadId="support" />;
}
```

When the app supplies an AgentKit transport instead, use `createTransport`:

```tsx
import { AssistantChat } from "@agent-native/core/client/agent-chat";
import type { AgentTransport } from "@agent-native/agentkit/protocol";

export function SupportChat({ transport }: { transport: AgentTransport }) {
  return <AssistantChat threadId="support" createTransport={() => transport} />;
}
```

## Migration steps

1. Run `npx @agent-native/core@latest upgrade --codemods` for deterministic
   import moves.
2. Run `npx agent-native doctor --only migration-manifest`. It reports imports
   of removed adapter APIs and links back to this guide.
3. Remove `createAdapter` and old adapter imports. Pass a runtime or transport
   directly, or keep the Core default transport.
4. If the app owned assistant-ui transcript state, replace that owner with
   AgentKit. Keep only one controller, queue, approval flow, and stream reader
   for each conversation.
5. Recheck the app's thread restore, send, attachment, tool, approval, and
   message-action flows. Keep existing actions, data, auth, access checks, and
   application-state keys where the app contract still applies.

TypeScript reports a normal missing-export error for removed named exports.
The package cannot customize that compiler diagnostic. Run the migration
doctor for the API name and direct link to this guide. The removed `createAdapter`
prop's type error includes the migration link, and JavaScript callers get a
runtime error with the same link.

## Find this guide in an app

The version-matched guide ships with Core at
`node_modules/@agent-native/core/docs/migrations/agentkit-chat.md`.
