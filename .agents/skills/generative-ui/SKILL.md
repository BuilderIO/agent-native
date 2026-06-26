---
name: generative-ui
description: >-
  Generate transient or saved inline chat UI with Alpine/Tailwind controls,
  outputs, app state, and extensions. Use for knobs, pickers, calculators,
  dashboards, widgets, or reusable mini-apps.
---

# Generative UI

Generative UI is sandboxed Alpine.js HTML rendered inline in chat. It is not a
source-code change and does not go through Builder.

## Pick the Lifetime

- Use `render-inline-extension` for one-off UI that belongs only in the current
  chat: knobs, controls, pickers, calculators, temporary charts, and previews.
- Use `create-extension` when the UI should be saved, reusable, or visible in
  the Extensions view. It also renders inline after creation.
- Use `show-extension-inline` to reopen a saved extension inside chat.
- Use `update-extension` to edit an existing saved extension.

## Inputs From Chat

Pass initial values through the action `context` argument. The iframe reads them
from `window.slotContext` and can subscribe to changes with
`window.onSlotContext(fn)`.

```html
<script>
  Alpine.data("controls", () => ({
    threshold: 50,
    init() {
      this.threshold = Number(window.slotContext?.threshold ?? 50);
      window.onSlotContext?.((ctx) => {
        if (ctx.threshold !== undefined) {
          this.threshold = Number(ctx.threshold);
        }
      });
    },
  }));
</script>
```

## Outputs To The Agent

Use passive output when a control's current value should be visible to the agent
on the next turn without requiring a submit click:

```html
<input
  type="range"
  min="0"
  max="100"
  x-model.number="threshold"
  @input="agentNative.ui.output({ threshold }, { label: 'Threshold' })"
/>
```

`agentNative.ui.output(value, opts?)` writes application state at:

```txt
inline-ui:<extensionId>:output
```

The id is scoped automatically; the HTML author must not pass it. When the user
says "use that value", "apply the current setting", or "run it with the current
selection", read the value with:

```ts
const output = await readAppState("inline-ui:<id>:output");
```

The stored payload includes `value`, `updatedAt`, `extensionId`, and
`source: "inline-ui"`, plus optional `label`, `context`, or `meta`.

Use `agentNative.chat.send(message, opts?)` or `sendToAgentChat(message, opts?)`
for a visible Apply/Submit button that should send a prompt or selected value
into the chat.

## App Data And State

- Prefer `appAction(name, params)` for template data and operations.
- Use `appFetch(path, options)` only for allowed framework endpoints under
  `/_agent-native/*`, including application-state reads and writes.
- Do not call template `/api/*` routes from generated UI.
- Use `dbQuery`/`dbExec` only for known existing SQL tables when no action fits.
- Use `extensionFetch` for external APIs through the sandbox proxy and secrets.

## Transient extensionData Boundary

For saved extensions, `extensionData` uses the authenticated database-backed
extension data API.

For transient inline UIs, `extensionData` is host `localStorage`. The agent
cannot read it, it does not sync across devices, it does not migrate when a UI
is promoted to a saved Extension, and the server does not garbage-collect it.
Use it only for throwaway local UI state.

For anything the agent or app must observe, use `agentNative.ui.output`,
application state through `appFetch`, an `appAction`, or
`agentNative.chat.send`.

## Styling

Use semantic Tailwind classes so the iframe inherits the parent app theme:

- `bg-background`, `text-foreground`, `border-border`
- `bg-card`, `text-card-foreground`
- `bg-primary`, `text-primary-foreground`
- `text-muted-foreground`, `bg-accent`

Do not hardcode provider tokens, private data, or internal secrets in generated
HTML. Do not call an LLM directly from the iframe; route AI work through the
agent chat.
