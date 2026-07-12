# MCP Apps Embedding Internals

Deep-dive reference for the optional MCP Apps UI surface — the `mcpApp` action
field, `embedApp()`, the host bridges (Claude / ChatGPT), embed start tickets,
extension-page rendering inside chat embeds, and host sizing. For the common
case (adding a `link` builder, connecting hosts, ingest actions, the
`/_agent-native/open` route), see `../SKILL.md`. This file is the expansion of
that skill's "Optional MCP Apps UI" section.

## Optional MCP Apps UI

For hosts that support the MCP Apps extension, an action can also advertise an
inline UI resource with `mcpApp`. This is a progressive enhancement for flows
where the external agent should hand the user an interactive surface instead of
only text — for example reviewing an email draft, editing a calendar invite, or
choosing between generated dashboard variants.

Use the real React app with `embedApp()` whenever the user needs UI. The mental
model is simple: the action's `link` target is also the MCP App embed target.
Expose the operation as a normal action/tool, return a focused deep link with
`link`, and add `mcpApp.resource = embedApp(...)` so capable hosts load that
same route inline instead of opening a new tab.

`embedApp()` supports both host bridges. Standard MCP Apps hosts use the
`ui/*` bridge; ChatGPT uses the `window.openai` compatibility bridge, reading
`toolInput` / `toolOutput` / `toolResponseMetadata` and calling
`create_embed_session` through `window.openai.callTool(...)`. Do not build a
ChatGPT-only HTML surface. Keep the action result and `link` target focused so
both bridges land on the same real app route.

That means full-app embeds can do anything the route can do once opened:
review or edit an email draft, show a filtered inbox/search, open a calendar
event or event draft, load an extension page, inspect a full analytics
dashboard or saved analysis, continue a deck in the Slides editor, or open a
Design project/editor. Prefer URL/deep-link params and the existing
`/_agent-native/open` navigation/app-state bridge over inventing a second
state protocol for MCP Apps.

On rare occasions the right target is a focused app route that renders one
shared React component instead of the whole app shell. Analytics' `/chart`
route is the model: it takes a compact `SqlPanel` payload in the URL and
renders the same chart component the dashboard uses. This is still an app
embed, not a plain HTML MCP App. Expose or call it through a normal action /
`open_app({ path, embed: true })`, keep the URL deterministic, and let
`embedApp()` render that route inline.

Do not hand-write one-off plain HTML MCP Apps for product UI; if the action
needs a custom surface, add or reuse a real app route/component first and embed
that route.

```ts
import { embedApp } from "@agent-native/core";

export default defineAction({
  // ...schema, run, link...
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

The MCP server advertises extension `io.modelcontextprotocol/ui`, adds
`_meta.ui.resourceUri` plus the legacy-compatible `_meta["ui/resourceUri"]` to
`tools/list`, and also emits ChatGPT Apps SDK compatibility metadata
(`openai/outputTemplate`, widget CSP/description/accessibility). It exposes the
HTML through `resources/list`, `resources/templates/list`, and `resources/read`
using MIME `text/html;profile=mcp-app`. The stdio proxy forwards those resource
handlers from the live app, so local desktop/CLI clients see the same resources
as HTTP clients.

Keep the existing `link` builder even when adding `mcpApp`. CLI-only clients,
older hosts, and any host that does not render MCP Apps will ignore the UI
metadata and still need the "Open in … →" link. `embedApp()` uses that link as
its launch target. Same-app `open_app({ embed: true })` mints the
`/_agent-native/embed/start` ticket during the original tool call so production
hosts do not need the iframe to make a second app-only helper call; custom
actions can return `embedStartUrl` for the same fast path. The MCP layer keeps
that ticket-bearing URL in hidden metadata and strips it from model-visible
structured content and normal open-link metadata. Otherwise the resource falls
back to the app-only `create_embed_session` helper. The embed start route
exchanges a one-time SQL ticket, then launches the real app route with a
short-lived browser session. Standard hosts navigate the MCP App frame
directly. Claude web uses a single-frame transplant path that fetches the
signed app HTML and hydrates it inside Claude's MCP App iframe because Claude
does not reliably allow app-owned child iframes or external frame navigation.
ChatGPT web uses a controlled route iframe for stable `window.openai` host APIs
and bounded height control. You can force the
single-frame transplant path in other hosts with `embedMode: "transplant"` or
`frame: "transplant"` when debugging host module loading, or force the nested
diagnostic iframe with `embedMode: "iframe"` /
`renderMode: "iframe"` / `nested: true` when debugging host behavior. Pass
additional `frameDomains` only for a custom MCP App that truly embeds a
third-party frame. `open_app({ app, path, embed: true })` is the generic
escape hatch for routes like full dashboards, filtered inboxes, calendar
drafts, analyses, or extension pages, and should be used liberally when the
full app is the clearest review/edit surface.

Do not set standard `_meta.ui.domain` to an app URL. That field is
host-specific: Claude validates hash subdomains such as
`{hash}.claudemcpcontent.com`, while ChatGPT has its own widget-domain
metadata. Let hosts choose their default sandbox origin unless you are emitting
a host-specific value on purpose. `embedApp()` may still emit
`openai/widgetDomain` for ChatGPT compatibility.

Extension pages are a special case inside MCP chat embeds. The normal app uses
`/_agent-native/extensions/:id/render` as a sandboxed child iframe, but MCP
chat hosts add another ancestor frame and can block that route via
`frame-ancestors` / `X-Frame-Options`. In MCP chat bridge mode the framework
renders the extension document as sandboxed `srcDoc` inside the existing app
route iframe instead; keep `sandbox="allow-scripts allow-forms"` and do not add
`allow-same-origin`.

For Dispatch, keep the single connector path first-class: the `open_app`
resource CSP should include the exact origins of apps granted through Dispatch,
not broad sources like `https:`. This lets Claude's transplant path fetch the
signed target app HTML while keeping the connector's resource surface narrow.

Host sizing rule: the MCP resource shell owns a bounded inline height and the
embedded route should scroll internally. `embedApp({ height })` defaults to a
`560px` shell, clamps to `320-900px`, and subtracts `44px` for the wrapper bar
before sizing the route viewport. Do not re-enable host SDK auto-resize for
full-app route embeds; Claude and ChatGPT can otherwise measure the whole
document and create a huge chat iframe. After changing the shell or `ui://`
resource version, verify with a fresh tool call because old conversation frames
keep the behavior they were rendered with.

Inside embedded routes, `sendToAgentChat({ submit: true })` posts
`agentNative.submitChat`; MCP App hosts receive that as model context plus a
visible `ui/message` turn, so an inline preview can intentionally continue the
Claude/ChatGPT conversation. Hidden context stays in model context; do not put
internal app-state file instructions into the visible prompt. `submit: false`
stays local as a prefill/review path.

When testing Claude through ngrok, use a production build (`pnpm exec agent-native build`
then `pnpm exec agent-native start`) or a deployed preview/production URL. Claude's
transplant path works with production asset chunks; raw Vite dev modules such
as `/app/root.tsx` can be app-auth protected and fail dynamic imports from the
Claude resource origin.

For known first-party handoffs, prefer a direct action with `mcpApp` over
letting the model hunt through screens. Examples: Mail `manage-draft` for email
drafts, Analytics `open-traffic-dashboard` for the first-party traffic
dashboard, Calendar `manage-event-draft` for invite drafts, and create/search
actions for Forms, Content, Clips, Slides, and Design. The action should return
concise structured content plus the link; it should not dump large catalogs or
HTML.

Compatibility target: build to the standard once, not per-client shims. MCP
Apps-capable hosts should include Claude/Claude Desktop/Claude Code, ChatGPT
custom MCP apps, VS Code GitHub Copilot, Goose, Postman, MCPJam, Cursor, and
any future host that follows the extension negotiation. Host support varies by
plan, release channel, and client version, so keep the deep link fallback.
