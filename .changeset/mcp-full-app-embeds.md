---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

MCP Apps outside a directory listing now open embed tools as the full app in the host's side panel: the server keeps the session an action minted, or mints a full-app session for the page the result links to, instead of falling back to a plain link. Directory listings still mount only scoped widgets.

A full-app panel acts as its verified owner, as a signed-in browser does: it runs actions, including UI-only ones, through the app's own UI. It cannot reach MCP or A2A approvals, sign-in and account changes, connections, OAuth starts, stored secrets and provider keys, developer routes, the app's own agent chat or automations, which it can read but not change, the public `/mcp` endpoint, the embed start route, an app's own `auth` routes, or any OAuth start, callback, connect or disconnect route, on GET too; it can read but not write app routes that store credentials by name, such as a template's `PUT /api/pylon/key`. Those still need a browser login. Actions declare the same with `requiresSignedInBrowser: true`, which the framework sets on its credential, member, service-token and key-policy actions and Dispatch sets on its vault, grant, app-access and linked-identity actions and on creating a browser chat session. A panel's signed token refuses those actions even after it expires or is revoked.

Dispatch's `open_app` asks the target app for an embed session whenever an MCP host calls it, so the full app opens in the host's side panel without the caller passing `embed: true`, and passes an explicit `embed: false` on so no panel opens.

An action that returns another app's embed start URL, such as `open_app`, declares `opensAnotherAppEmbed: true` so the MCP server keeps that URL, whether the app runs on its own origin or under another mount on this one. Other actions keep only a session this app minted for the caller.

When `open_app` cannot get a session from the target app, its result says why in `embedUnavailable` instead of looking like a plain link, and it waits at most 15 seconds for the target before answering with the link, stopping the target request when it gives up.

`read_view` reports load errors and failed requests from the app open beside the chat in `errors`, including whether a failed request carried the panel session, so a blank or stuck panel says why instead of returning empty text.

Hashed build assets are served with `Access-Control-Allow-Origin: *`, so an app opened in an MCP host's side panel can load its code from the host's sandbox instead of rendering blank.
