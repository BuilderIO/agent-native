---
title: "Component API"
description: "Public React building blocks for custom agent UI, chat fields, conversation rendering, realtime presence, sharing, progress, and rich editors."
---

# Component API

Agent-Native ships a full sidebar, but the sidebar is not the contract. The
contract is the runtime: chat streaming, thread state, actions, context,
attachments, model selection, runs, and SQL-backed sync. Use the stock
components when you can, and drop down a layer when you need custom product UI.

Import browser UI from focused client subpaths:

```tsx
import { AgentSidebar } from "@agent-native/core/client";
import { PromptComposer } from "@agent-native/core/client/composer";
import { AgentConversation } from "@agent-native/core/client/conversation";
import { usePresence } from "@agent-native/core/client/collab";
import { SharedRichEditor } from "@agent-native/core/client/editor";
import { ResourcesPanel } from "@agent-native/core/client/resources";
```

Avoid importing UI components from the bare `@agent-native/core` package. Use
`@agent-native/core/client` or a focused `@agent-native/core/client/*` subpath
so bundlers choose the browser-safe entry.

## Agent And Chat UI {#agent-chat-ui}

| API                        | Import path                                   | Use when                                                                                         |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `<AgentSidebar>`           | `@agent-native/core/client` or `/client/chat` | You want the complete sidebar around your app.                                                   |
| `<AgentToggleButton>`      | `@agent-native/core/client` or `/client/chat` | You render your own header button for the sidebar.                                               |
| `<AgentPanel>`             | `@agent-native/core/client` or `/client/chat` | You want the full panel in your own layout, route, dialog, or side column.                       |
| `<AgentChatSurface>`       | `@agent-native/core/client` or `/client/chat` | You want chat in panel or page mode without the sidebar wrapper.                                 |
| `<AssistantChat>`          | `@agent-native/core/client` or `/client/chat` | You want to own surrounding chrome while keeping the standard conversation and composer runtime. |
| `<MultiTabAssistantChat>`  | `@agent-native/core/client` or `/client/chat` | You want the framework's thread tabs without `AgentPanel` chrome.                                |
| `createAgentChatAdapter()` | `@agent-native/core/client` or `/client/chat` | You are building a custom assistant-ui runtime and need the Agent-Native chat transport.         |
| `useChatThreads()`         | `@agent-native/core/client` or `/client/chat` | You need a custom thread list, history picker, or scoped chat UI.                                |
| `sendToAgentChat()`        | `@agent-native/core/client` or `/client/chat` | A product action should hand work to the agent chat.                                             |

The shortest custom route is still a pre-wired surface:

```tsx
import { AgentChatSurface } from "@agent-native/core/client/chat";

export default function ChatRoute() {
  return <AgentChatSurface mode="page" className="h-screen" />;
}
```

For custom chrome around the standard runtime:

```tsx
import { AssistantChat, useChatThreads } from "@agent-native/core/client/chat";

function CustomChat({ projectSlug }: { projectSlug: string }) {
  const threads = useChatThreads(undefined, projectSlug);
  const threadId = threads.activeThreadId ?? undefined;

  return (
    <section className="grid h-full grid-cols-[260px_1fr]">
      <ThreadList
        threads={threads.threads}
        activeThreadId={threadId}
        onSelect={threads.switchThread}
      />
      <AssistantChat threadId={threadId} />
    </section>
  );
}
```

## Chat Field And Composer {#composer}

Use `@agent-native/core/client/composer` when you need to place the same chat
field used by the sidebar inside custom UI.

| API                               | Use when                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<PromptComposer>`                | You need a ready-to-submit chat field with attachments, slash commands, references, pasted-text handling, draft persistence, voice input, and submission semantics. |
| `<AgentComposerFrame>`            | You want the standard visual shell around a custom composer body.                                                                                                   |
| `<TiptapComposer>`                | You need the lowest-level rich chat field. It must be rendered inside an assistant-ui `ThreadPrimitive.Root` / composer runtime.                                    |
| `buildPromptComposerSubmission()` | You need the same attachment and pasted-text normalization before calling your own submit handler.                                                                  |
| `formatPromptWithAttachments()`   | You need to render hidden attachment metadata into a prompt string.                                                                                                 |

Most custom UIs should start with `PromptComposer`:

```tsx
import { PromptComposer } from "@agent-native/core/client/composer";

<PromptComposer
  placeholder="Ask the agent..."
  onSubmit={async (text, files, references, options) => {
    await sendMessageToYourRuntime({ text, files, references, options });
  }}
/>;
```

Use `TiptapComposer` only if you are already wiring assistant-ui primitives
yourself. It is the field, not the whole chat runtime.

## Conversation Rendering {#conversation}

Use `@agent-native/core/client/conversation` for transcript-style rendering
outside the full agent runtime.

| API                                             | Use when                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `<AgentConversation>`                           | Render a list of normalized agent messages.                      |
| `<AgentConversationMessageView>`                | Render one normalized message.                                   |
| `normalizeCodeAgentTranscriptForConversation()` | Convert code-agent transcript events into conversation messages. |
| `useNearBottomAutoscroll()`                     | Keep a custom transcript pinned to the bottom while streaming.   |

This layer is intentionally data-first: you own where messages come from, and
the renderer owns consistent markdown, attachments, notices, artifacts, and
tool-call display.

## Realtime Collab And Presence {#collab-presence}

Use `@agent-native/core/client/collab` for Liveblocks-style presence and
collaborative document hooks.

| API                                                 | Use when                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `useCollaborativeDoc()`                             | Bind a rich text editor or custom Yjs surface to `/_agent-native/collab`.                   |
| `usePresence()`                                     | Publish and render arbitrary awareness fields: cursors, selections, viewport, mode.         |
| `<PresenceBar>`                                     | Show active human and agent collaborators.                                                  |
| `<LiveCursorOverlay>`                               | Render remote cursor labels over a positioned container.                                    |
| `<RemoteSelectionRings>`                            | Render remote selection outlines over DOM elements.                                         |
| `useFollowUser()`                                   | Follow another participant's viewport or selection.                                         |
| `useCollaborativeMap()` / `useCollaborativeArray()` | Experiment with structured Y.Map/Y.Array state when rich-text body collab is the wrong fit. |
| `dedupeCollabUsersByEmail()`                        | Build a custom avatar stack without duplicate tabs for the same user.                       |

Server-side agent actions that want to appear as a live participant use the
lower-level `@agent-native/core/collab` agent presence helpers:

```ts
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
} from "@agent-native/core/collab";
```

## Rich Editor {#rich-editor}

Use `@agent-native/core/client/editor` when you need the shared markdown editor
surface used by plans, content, resources, and collaborative document
experiences.

| API                              | Use when                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `<SharedRichEditor>`             | You need the current, configurable editor with markdown serialization, optional Yjs, and app extras. |
| `<RichMarkdownEditor>`           | You need the backwards-compatible alias for the shared rich editor.                                  |
| `createSharedEditorExtensions()` | You are building your own Tiptap editor but want the framework schema and markdown dialects.         |
| `<SlashCommandMenu>`             | You need the shared slash-command UI for a custom Tiptap surface.                                    |
| `<BubbleToolbar>`                | You need the shared selection toolbar for marks, links, and custom inline actions.                   |
| `createRegistryBlockNode()`      | You need registry-backed block nodes inside a rich editor.                                           |
| `uploadEditorImage()`            | You want the framework upload-image action behind the editor's shared image block.                   |
| `useCollabReconcile()`           | You are binding a custom editor surface to a Yjs doc while preserving markdown as saved state.       |

The basic controlled editor is just markdown in and markdown out:

```tsx
import { SharedRichEditor } from "@agent-native/core/client/editor";

<SharedRichEditor
  value={markdown}
  onChange={setMarkdown}
  placeholder="Write notes..."
  features={{ tables: true, tasks: true, link: true }}
/>;
```

For realtime editing, pair it with the collab subpath:

```tsx
import {
  emailToColor,
  useCollaborativeDoc,
} from "@agent-native/core/client/collab";
import { SharedRichEditor } from "@agent-native/core/client/editor";

const editorUser = {
  name: user.name,
  email: user.email,
  color: emailToColor(user.email),
};
const collab = useCollaborativeDoc({
  docId,
  user: editorUser,
});

<SharedRichEditor
  value={markdown}
  onChange={setMarkdown}
  ydoc={collab.ydoc}
  awareness={collab.awareness}
  user={editorUser}
/>;
```

## Workspace Resources {#resources}

Use `@agent-native/core/client/resources` when you want to expose the same
workspace resource model that powers the agent panel's Workspace tab.

| API                                                                   | Use when                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `<ResourcesPanel>`                                                    | You want the complete Workspace tab as a page, drawer, or custom panel. |
| `<ResourceTree>`                                                      | You want to render your own resource browser around framework data.     |
| `<ResourceEditor>`                                                    | You want the framework editor for a selected resource.                  |
| `useResourceTree()`                                                   | You need a scoped tree for personal, shared, or workspace resources.    |
| `useResource()`                                                       | You need the content and metadata for one selected resource.            |
| `useCreateResource()` / `useUpdateResource()` / `useDeleteResource()` | You need custom controls around the resource lifecycle.                 |
| `useUploadResource()`                                                 | You need file upload into the framework resource store.                 |

The complete panel needs no props:

```tsx
import { ResourcesPanel } from "@agent-native/core/client/resources";

<ResourcesPanel />;
```

For custom resource chrome, keep the hooks and primitives together:

```tsx
import { useState } from "react";
import {
  ResourceEditor,
  ResourceTree,
  useResource,
  useResourceTree,
  useUpdateResource,
} from "@agent-native/core/client/resources";

function WorkspaceResources() {
  const tree = useResourceTree("workspace");
  const updateResource = useUpdateResource();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const resource = useResource(selectedId);

  return (
    <div className="grid h-full grid-cols-[260px_1fr]">
      <ResourceTree
        tree={tree.data ?? []}
        selectedId={selectedId}
        onSelect={(item) => setSelectedId(item.id)}
        onCreateFile={() => {}}
        onCreateFolder={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
        onDrop={() => {}}
      />
      {resource.data ? (
        <ResourceEditor
          resource={resource.data}
          onSave={(content) =>
            updateResource.mutate({ id: resource.data.id, content })
          }
        />
      ) : null}
    </div>
  );
}
```

## Other Public UI {#other-ui}

| Area          | APIs                                                   | Import path                               |
| ------------- | ------------------------------------------------------ | ----------------------------------------- |
| Sharing       | `<ShareButton>`, `<ShareDialog>`, `<VisibilityBadge>`  | `@agent-native/core/client/sharing`       |
| Notifications | `<NotificationsBell>`                                  | `@agent-native/core/client/notifications` |
| Progress      | `<RunsTray>`, progress hooks and types                 | `@agent-native/core/client/progress`      |
| Onboarding    | `useOnboarding()`, onboarding panel hooks              | `@agent-native/core/client/onboarding`    |
| Observability | `<ObservabilityDashboard>`, `<ThumbsFeedback>`         | `@agent-native/core/client/observability` |
| Resources     | `<ResourcesPanel>`, `<ResourceTree>`, resource hooks   | `@agent-native/core/client/resources`     |
| Rich editor   | `<SharedRichEditor>`, slash commands, block node hooks | `@agent-native/core/client/editor`        |

## One-Off Text Completion {#one-off-text-completion}

If you truly need raw text-in/text-out, keep it server-side and use
`completeText()` from `@agent-native/core/server`. Wrap user-facing usage in an
action so the UI and agent share the same capability.

```ts
import { defineAction } from "@agent-native/core";
import { completeText } from "@agent-native/core/server";

export default defineAction({
  description: "Classify a short message",
  run: async ({ body }: { body: string }) => {
    const result = await completeText({
      systemPrompt: "Return exactly one label.",
      input: body,
      maxOutputTokens: 12,
      temperature: 0,
    });
    return { label: result.text.trim() };
  },
});
```

Use `sendToAgentChat({ background: true, openSidebar: false })` instead when
the work needs tools, state, auditability, user steering, or multi-step
reasoning.
