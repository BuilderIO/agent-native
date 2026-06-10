---
title: "MCP Apps"
description: "Author and embed interactive MCP App UIs inside Claude, ChatGPT, and other compatible hosts — using real app routes, the embed bridge, and the host bridge API."
---

# MCP Apps

MCP Apps are the official `io.modelcontextprotocol/ui` extension that lets compatible hosts — Claude, Claude Desktop, ChatGPT, VS Code GitHub Copilot, Goose, Postman, MCPJam, and Cursor — render interactive UIs inline in chat. In agent-native apps, every MCP App is a **real React route**, not a separate plain-HTML widget.

For connecting external agents and the broader MCP server setup, see [External Agents](/docs/external-agents) and [MCP Protocol](/docs/mcp-protocol). This page covers authoring MCP App resources and the embed bridge that powers them.

## Authoring: optional MCP Apps UI {#mcp-apps}

For hosts that support the MCP Apps extension, an action can also advertise an inline UI resource with `mcpApp`. This is a progressive enhancement for flows where the external agent should hand the user an interactive surface instead of only text — for example reviewing an email draft, editing a calendar invite, or choosing between generated dashboard variants.

Use the real React app with `embedRoute()` or `embedApp()` whenever the user needs UI. The mental model is simple: the action's `link` target is also the MCP App embed target. Expose the operation as a normal action/tool, return a focused deep link with `link`, and add `mcpApp.resource = embedApp(...)` so capable hosts load that same route inline instead of opening a new tab. When both should be built from the same route, prefer `embedRoute({ title, openLabel, path })`: it is the convenience wrapper that returns matching `link` and `mcpApp` fields from one call, while `embedApp(...)` is the lower-level resource you assign to `mcpApp.resource` directly.

That means full-app embeds can do anything the route can do once opened: review or edit an email draft, show a filtered inbox/search, open a calendar event or event draft, load an extension page, inspect a full analytics dashboard or saved analysis, continue a deck in the Slides editor, or open a Design project/editor. Prefer URL/deep-link params and the existing `/_agent-native/open` navigation/app-state bridge over inventing a second state protocol for MCP Apps.

On rare occasions the right target is a focused app route that renders one shared React component instead of the whole app shell. Analytics' `/chart` route is the model: it takes a compact `SqlPanel` payload in the URL and renders the same chart component the dashboard uses. This is still an app embed, not a plain HTML MCP App. Expose or call it through a normal action / `open_app({ path, embed: true })`, keep the URL deterministic, and let `embedApp()` render that route inline.

Do not hand-write one-off plain HTML MCP Apps for product UI; if the action needs a custom surface, add or reuse a real app route/component first and embed that route.

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...description, schema, run, link...
  mcpApp: {
    resource: embedApp({
      title: "Review draft",
      description: "Open the generated draft in the real Mail compose UI.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
    }),
  },
});
```

The MCP server advertises extension `io.modelcontextprotocol/ui`, adds `_meta.ui.resourceUri` plus `_meta["ui/resourceUri"]` to `tools/list`, and also emits ChatGPT Apps SDK compatibility metadata (`openai/outputTemplate`, widget CSP/description/accessibility). It exposes the HTML through `resources/list`, `resources/templates/list`, and `resources/read` using MIME `text/html;profile=mcp-app`. The stdio proxy forwards those resource handlers from the live app, so desktop and CLI clients see the same resources as HTTP clients.

Keep the existing `link` builder even when adding `mcpApp`. CLI-only clients, older hosts, and any host that does not render MCP Apps will ignore the UI metadata and still need the `"Open in … →"` link. `embedApp()` uses that link as its launch target, calls the app-only `create_embed_session` helper, exchanges a one-time SQL ticket at `/_agent-native/embed/start`, and navigates the MCP App frame to the target route with a short-lived browser session plus a bearer fallback for same-origin fetches. `open_app({ app, path, embed: true })` is the generic escape hatch for routes such as full dashboards, filtered inboxes, calendar draft views, analyses, and extension pages, and should be used liberally when the full app is the clearest review/edit surface.

`embedApp()` includes the MCP request origin in the resource CSP so the launcher can fetch and, when explicitly requested, frame the signed first-party app route. Dispatch adds the exact origins for the granted apps to its `open_app` resource so a single Dispatch connector can inline Mail, Calendar, Slides, and the rest without allowing every HTTPS origin. Only pass additional frame or resource domains for a custom MCP App that truly embeds a third-party player or loads third-party assets.

Inside those `embedApp()` routes, `sendToAgentChat()` is embed-aware. Auto-submitted prompts relay to the MCP host as `ui/update-model-context` plus `ui/message`, so a button in the embedded app can intentionally continue the Claude/ChatGPT conversation from the selected app state. Hidden context is sent as model context; the visible user turn stays just the app's prompt, which avoids scary host consent around internal app-state file paths. `submit: false` remains local prefill/review behavior.

## First-class MCP App bridge {#mcp-app-bridge}

MCP App embeds are route embeds, not separate mini-products. `embedApp()` starts from the action's `link` target, creates a short-lived embed session, and launches that signed app route. Standard MCP Apps hosts can navigate the MCP App frame itself when the host can hydrate the route directly. Claude web uses a single-frame transplant path: the resource document fetches the signed app HTML and hydrates it inside Claude's MCP App iframe because Claude does not reliably allow app-owned child iframes or external frame navigation. ChatGPT web gets a controlled route iframe because its Apps bridge gives us stable `window.openai` host APIs and bounded height control. All paths point at the same signed app route and render the normal route and React components. Design embedded routes so a reload with the same signed URL reconstructs the same view.

For same-app `open_app({ embed: true })`, the framework mints the embed-start ticket during the original tool call and stores the signed start URL in hidden tool metadata. Custom actions can return `embedStartUrl` for the same fast path; the MCP layer strips that ticket-bearing URL from model-visible `structuredContent` and normal open-link metadata. When no embed start URL is present, the resource falls back to the app-only `create_embed_session` helper. This keeps production hosts that restrict iframe-initiated tool calls on the direct route without leaking one-time app session URLs into the transcript. If a user reopens an old chat after a one-time start ticket has expired, the start route returns a small refresh page and posts `agentNative.embedSessionExpired` to the wrapper; `embedApp()` clears the stale start URL and mints a fresh ticket through `create_embed_session` when it still has the original app route.

ChatGPT gets a dedicated compatibility path through `window.openai`: the launch document reads `toolInput`, `toolOutput`, and `toolResponseMetadata` directly, then calls `create_embed_session` via `window.openai.callTool(...)`. Standard MCP Apps hosts use the `ui/*` JSON-RPC bridge. Directly hydrated routes can call `ui/update-model-context`, `ui/message`, `ui/open-link`, and `ui/request-display-mode` through the host bridge helpers. Claude's transplanted route uses the same direct `ui/*` host bridge after hydration. When the ChatGPT or explicit diagnostic iframe path is used, the wrapper relays the same host actions over `agentNative.mcpHost.*` postMessage requests. Keep the result shape identical for both paths: return a focused `link` and concise structured content.

Do not set standard `_meta.ui.domain` to an app URL. MCP Apps treats that field as host-specific: Claude validates `{hash}.claudemcpcontent.com`-style sandbox domains, while ChatGPT uses its own `openai/widgetDomain` metadata. Omit `ui.domain` unless you are deliberately emitting a host-specific value; the host will choose a default sandbox origin.

Extension pages keep their sandbox in MCP chat embeds without navigating a second route iframe. Normal app usage renders `/_agent-native/extensions/:id/render` as a sandboxed child iframe. In MCP chat bridge mode the framework renders the same extension document as sandboxed `srcDoc` inside the route iframe, avoiding host `frame-ancestors` / `X-Frame-Options` failures while preserving `sandbox="allow-scripts allow-forms"`.

The resource shell owns the outer host size. `embedApp({ height })` defaults to `560px`, clamps the shell to `320-900px`, and reserves `44px` for the small toolbar, so the route viewport is `height - 44px`. Keep embedded app routes internally scrollable and let the launcher report that bounded intrinsic height rather than the full document height; otherwise host auto-resize can turn a normal app page into a very tall chat artifact. A changed shell only affects new MCP App resources and new tool calls. Old ChatGPT/Claude conversation frames can keep the previous resource behavior, so verify sizing with a fresh inline render before judging a fix.

### Embed modes {#embed-modes}

Claude uses the single-frame transplant path by default. You can also force it in other hosts with `embedMode: "transplant"` or `frame: "transplant"` when debugging host module-loading behavior. You can force the nested diagnostic iframe with `embedMode: "iframe"`, `renderMode: "iframe"`, `nested: true`, or `frame: "iframe"`. If the iframe is blocked, `embedApp()` replaces it with an open-app fallback: the user can retry inline, open a freshly minted embed session through the host, or use the visible route URL. Keep the action's `link` target useful on its own because it is still the universal escape hatch.

When testing Claude through ngrok, use a production build (`agent-native build` then `agent-native start`) or a deployed preview/production URL. Claude's single-frame transplant path works with production asset chunks; raw Vite dev modules such as `/app/root.tsx` can be protected by app auth and fail dynamic imports from the Claude resource origin.

## Host bridge API {#host-bridge}

The host bridge is deliberately small:

| Mode                   | Message type                          | Use it for                               |
| ---------------------- | ------------------------------------- | ---------------------------------------- |
| direct host route      | `ui/update-model-context`             | Hidden context for the host model        |
| direct host route      | `ui/message`                          | Post a visible user turn into the host   |
| direct host route      | `ui/open-link`                        | Open an external or app URL via the host |
| direct host route      | `ui/request-display-mode`             | Request `inline`, `fullscreen`, or `pip` |
| Claude transplant      | `ui/*`                                | Same direct host bridge after hydration  |
| ChatGPT / iframe route | `agentNative.mcpHostContext`          | Theme, locale, host platform, dimensions |
| ChatGPT / iframe route | `agentNative.embeddedAppReady`        | Confirm the route iframe loaded          |
| ChatGPT / iframe route | `agentNative.mcpHost.*` / `.response` | Wrapper relay for host requests          |

Embedded routes can use `updateMcpAppModelContext()`, `openMcpAppHostLink()`, `requestMcpAppDisplayMode()`, `getMcpAppHostContext()`, and `useMcpAppHostContext()` from `@agent-native/core/client`. `sendToAgentChat()` uses the same path from full-app embeds for auto-submitted prompts.

Display mode is best-effort. The in-app `McpAppRenderer` currently reports an inline web host context and an inline-only display mode; external hosts may honor larger display requests, ignore them, or reply with an unsupported-mode error. Always keep the inline route usable.

## Client support and caching {#client-support}

The current official MCP Apps client list includes Claude, Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam, ChatGPT, and Cursor; host support still varies by plan, release channel, and client version, so check the [MCP extension support matrix](https://modelcontextprotocol.io/extensions/client-matrix). ChatGPT custom MCP apps are available through developer mode for Business and Enterprise/Edu workspaces on ChatGPT web; see OpenAI's [developer mode and MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta) notes.

Claude Code, Codex, and other CLI/code-editor clients still receive the same resources and metadata when they support MCP Apps, but treat them as link-out hosts unless you have verified inline iframe rendering in that exact surface. The deep link remains the reliable fallback when a host chooses not to render an iframe. In practice, every agent-native app should be authored with both: MCP Apps for inline review/edit in capable hosts, and `link` for universal round-tripping back to the full app.

Claude and ChatGPT can cache tool and resource metadata for an existing custom connector. After changing MCP App metadata, verify with a fresh tool call; if the host still uses the old descriptor, reconnect the Claude connector or rescan/review the ChatGPT connector so it refreshes the catalog. If Claude logs a warning about `_meta.ui.csp` or `_meta.ui.permissions` living on the tool descriptor after a deploy, that connector is using stale metadata: delete/reconnect the Claude connector and start a fresh chat.

## Testing {#testing}

Test MCP Apps with the lightweight fixtures around `embedApp()` and `McpAppRenderer`; they cover CSP, host context, app launch, and bridge message behavior without needing a real external host. When validating ChatGPT or Claude web, trigger a fresh tool call after shell changes and measure the visible iframe. Previously rendered frames in the same conversation may still show cached height or launch behavior.

## Related {#related}

- [External Agents](/docs/external-agents) — connecting Claude, ChatGPT, Codex, and Cursor to hosted apps; MCP Apps compatibility matrix; catalog tiers; deep links.
- [MCP Protocol](/docs/mcp-protocol) — the auto-mounted MCP server, auth, tools, and `ask-agent`.
- [Actions](/docs/actions) — `defineAction`, the `link` builder, `publicAgent`.
