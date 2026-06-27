---
title: "Generative UI"
description: "Let the agent generate sandboxed interactive UI inline in chat, either transient for one turn or saved as reusable Extensions."
search: "generative UI inline extension render-inline-extension create-extension show-extension-inline sandboxed Alpine Tailwind slotContext sendToAgentChat agentNative.chat.send agentNative.ui.output"
---

# Generative UI

Generative UI is the chat-native path for interactive surfaces the agent creates
at runtime. Instead of replying with only prose or a static table, the agent can
render a sandboxed Alpine.js/Tailwind mini-app directly inside the transcript:
controls, knobs, calculators, pickers, visualizers, dashboards, or any focused
surface that helps the user inspect and adjust an answer.

There are two lifetimes:

- **Transient** — `render-inline-extension` renders a one-time UI in the
  current chat. It is not saved to the Extensions view.
- **Persisted** — `create-extension` saves the UI as an Extension and renders it
  inline immediately. Later, `show-extension-inline` can load that saved
  extension back into any chat.

Both paths use the same sandboxed extension runtime as [Extensions](/docs/extensions):
the generated HTML runs in an iframe with no host DOM access and reaches the app
only through scoped bridge helpers.

```an-diagram title="Generated UI in chat" summary="The agent chooses a lifetime, returns an inline-extension payload, and chat mounts the sandboxed extension frame."
{
  "html": "<div class=\"diagram-generative-ui\"><div class=\"diagram-card\" data-rough><strong>User asks</strong><small class=\"diagram-muted\">\"give me sliders for this model\"</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel\"><span class=\"diagram-pill accent\">Agent</span><small class=\"diagram-muted\">writes Alpine + Tailwind</small><div class=\"diagram-row\"><span class=\"diagram-pill\">transient</span><span class=\"diagram-pill\">persisted</span></div></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-card\" data-rough><strong>Chat iframe</strong><small class=\"diagram-muted\">same theme · app bridge · chat output</small></div></div>",
  "css": ".diagram-generative-ui{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-generative-ui .diagram-card,.diagram-generative-ui .diagram-panel{display:flex;flex-direction:column;gap:7px;padding:14px 16px;min-width:180px}.diagram-generative-ui .diagram-row{display:flex;gap:6px;flex-wrap:wrap}.diagram-generative-ui .diagram-arrow{font-size:22px;line-height:1}"
}
```

## When to use it {#when-to-use-it}

Use generative UI when the user needs to manipulate or inspect an answer in the
chat itself:

- tune weights, thresholds, ranges, or filters with controls
- compare generated variants side by side
- preview a calculation before committing it
- select items from app data and send the choice back to chat
- explore a temporary chart or dashboard without adding a route

Use a normal [Native Chat UI](/docs/native-chat-ui) data widget when a typed
action already knows the result shape, such as a table, chart, or insights
summary. Use [MCP Apps](/docs/mcp-apps) when an external host like Claude or
ChatGPT should render a real app route inline. Use a full app screen when the
surface is a durable product workflow users will browse outside chat.

## Agent actions {#actions}

The built-in extension actions are the agent-facing API:

| Action                    | Saves to Extensions | Renders inline | Use it for                                     |
| ------------------------- | ------------------- | -------------- | ---------------------------------------------- |
| `render-inline-extension` | No                  | Yes            | one-time controls, pickers, calculators, demos |
| `create-extension`        | Yes                 | Yes            | reusable widgets, dashboards, mini-apps        |
| `show-extension-inline`   | Already saved       | Yes            | reopening a saved extension inside a chat      |
| `update-extension`        | Yes                 | On next render | editing an existing saved extension            |

The action result declares `chatUI: { renderer: "core.inline-extension" }`.
Assistant chat and the lightweight `AgentConversation` transcript both use that
metadata to render the sandboxed UI instead of showing raw JSON.

## Inputs from chat {#inputs}

Pass chat inputs through the action `context` argument. The generated iframe
receives that object as `window.slotContext`, and can subscribe to updates with
`window.onSlotContext(fn)`.

```html
<div x-data="thresholdTuner">
  <label class="text-sm font-medium text-foreground">Threshold</label>
  <input
    type="range"
    min="0"
    max="100"
    x-model.number="threshold"
    class="w-full"
  />
  <p class="text-sm text-muted-foreground" x-text="`Current: ${threshold}`"></p>
</div>

<script>
  Alpine.data("thresholdTuner", () => ({
    threshold: 50,
    init() {
      this.threshold = Number(window.slotContext?.threshold ?? 50);
      window.onSlotContext?.((ctx) => {
        if (ctx.threshold !== undefined) this.threshold = Number(ctx.threshold);
      });
    },
  }));
</script>
```

## App state and app data {#app-state}

Generated UI can see and update the app through the standard extension bridge:

- `appAction(name, params)` calls template/framework actions.
- `appFetch(path, options)` calls allowed framework routes under
  `/_agent-native/*`, including application-state endpoints.
- `extensionData` stores per-extension data. Transient inline UIs get a local
  chat-scoped adapter; persisted extensions use the normal authenticated
  database-backed extension data API.
- `dbQuery`, `dbExec`, and `extensionFetch` are available with the same role and
  route gates as saved extensions.

Prefer `appAction` for domain data. Actions carry validation, access checks, and
business rules; raw SQL is for cases where no action exists.

For transient UIs, `extensionData` is intentionally local to the browser. It is
stored in host `localStorage`, is not visible to the agent or backend, does not
sync across devices, does not migrate if the UI is later promoted to a saved
Extension, and is not garbage-collected by the server. Use it only for
throwaway local UI state. If the agent or the app needs to observe a value, use
`agentNative.ui.output`, application state through `appFetch`, an `appAction`, or
`agentNative.chat.send`.

## Outputs back to chat {#outputs}

Use passive output for controls whose current value should be readable later
without forcing the user to click a submit button:

```html
<div x-data="{ threshold: 50 }">
  <input
    type="range"
    min="0"
    max="100"
    x-model.number="threshold"
    @input="agentNative.ui.output({ threshold }, { label: 'Threshold' })"
    class="w-full"
  />
</div>
```

`agentNative.ui.output(value, options)` writes the current value to
application state under a conventioned key:

```txt
inline-ui:<extensionId>:output
```

The stored value includes the submitted `value`, `updatedAt`, `extensionId`, and
`source: "inline-ui"`, plus optional `label`, `context`, or `meta` fields. When
the user says "use that value" or "apply the current selection", the agent reads
that key with `readAppState("inline-ui:<id>:output")`.

Generated UI can send a visible prompt or result back into the current app chat:

```html
<button
  class="rounded-md bg-primary px-3 py-2 text-primary-foreground"
  @click="agentNative.chat.send(`Use threshold ${threshold}`, {
    context: JSON.stringify({ threshold }),
    submit: true
  })"
>
  Apply in chat
</button>
```

`agentNative.chat.send(message, options)` is also available as
`sendToAgentChat(message, options)`.

Options:

| Option        | Default | Effect                                           |
| ------------- | ------- | ------------------------------------------------ |
| `context`     | none    | hidden context appended to the submitted message |
| `submit`      | `true`  | `false` pre-fills/reviews instead of auto-submit |
| `openSidebar` | `true`  | opens the agent sidebar when the message is sent |

This is the same app chat bridge used by normal UI components, so generated
controls can hand structured selections back to the agent without calling an LLM
directly from the iframe.

## Styling and theming {#theming}

Generated UI uses the app's Tailwind theme tokens. Prefer semantic classes:

- `bg-background`, `text-foreground`, `border-border`
- `bg-card`, `text-card-foreground`
- `bg-primary`, `text-primary-foreground`
- `text-muted-foreground`, `bg-accent`

The extension shell injects the same CSS variables as the parent app and pushes
theme updates into the iframe. Avoid hardcoded one-off colors unless the user
asks for a specific brand treatment.

## Security model {#security}

Generative UI is arbitrary user-authored HTML, so it always runs in the
extension sandbox:

- iframe sandbox excludes `allow-same-origin`
- no parent DOM or cookies are exposed to generated code
- bridge requests are path-allowlisted under `/_agent-native/*`
- viewer/editor/owner role policy is enforced in the parent before requests are
  sent, and again server-side for saved extension data
- template `/api/*` routes are not reachable through `appFetch`; expose domain
  operations as actions instead

Do not put provider tokens, private data, or internal secrets directly in the
generated HTML. Use `extensionFetch()` with `${keys.NAME}` placeholders or
template actions that resolve credentials server-side.

## Related docs {#related}

- [Extensions](/docs/extensions) — saved sandboxed mini-apps and the bridge API.
- [Native Chat UI](/docs/native-chat-ui) — typed first-party React widgets for
  action results.
- [MCP Apps](/docs/mcp-apps) — inline app routes in external MCP hosts.
- [Actions](/docs/actions) — the app/API surface generated UI should call.
