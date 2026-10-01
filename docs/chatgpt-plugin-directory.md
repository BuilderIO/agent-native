# ChatGPT Plugin Directory

This repository prepares three focused ChatGPT plugins: Slides, Design, and Content. Each listing connects to one app’s hosted MCP endpoint and exposes a curated action set. Separate listings keep each task description, authorization, review cases, and app destination clear.

The public `/apps/*` descriptions are the starting point for listing copy. ChatGPT’s metadata limits require shorter subtitles, and each long description names the supported tasks and the connector’s boundaries. Listing metadata and review cases live in each app’s `agent-native.app-skill.json` under `chatgpt`.

## Production endpoints

Connect these servers or rescan their domains in OpenAI’s dashboard only after PR #6542 is merged and the app deployments are promoted.

| App     | MCP directory                                    | OpenAI challenge                                                     |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Slides  | <https://slides.agent-native.com/mcp/directory>  | <https://slides.agent-native.com/.well-known/openai-apps-challenge>  |
| Design  | <https://design.agent-native.com/mcp/directory>  | <https://design.agent-native.com/.well-known/openai-apps-challenge>  |
| Content | <https://content.agent-native.com/mcp/directory> | <https://content.agent-native.com/.well-known/openai-apps-challenge> |

The MCP endpoints require authentication. After promotion, each challenge URL returns 404 until that app’s dashboard-issued `OPENAI_APPS_CHALLENGE_TOKEN` is configured and the app is redeployed. After redeployment, verify that the public challenge response exactly matches the token OpenAI issued for that domain.

## Build the upload packages

Run:

```sh
pnpm pack:chatgpt-plugins
```

The command validates metadata, review case counts, tool names, icon dimensions, and unique widget origins. It writes three ZIPs and a handoff file to `.tmp/chatgpt-plugin-submissions/`. It stops if that output directory already exists; choose another `--out` path after changing metadata:

```sh
pnpm pack:chatgpt-plugins -- --out=.tmp/chatgpt-plugin-submissions-next
```

Each ZIP contains only a portable root `plugin.json`, root `mcp.json`, and the app logo under `assets/`. It contains no app source, reviewer login, password, API token, or challenge token. Each `mcp.json` declares one `streamable-http` MCP server at the app’s hosted `/mcp/directory` endpoint.

The ZIPs include five positive and three negative review cases. They remain **DRAFT** until a reviewer-accessible demo recording URL is added to each source manifest at `chatgpt.review.demo_recording_url` and the packages are rebuilt. The initial draft ZIP is used to connect and exercise each listing; after recording the walkthroughs, upload the rebuilt ZIPs with their demo URLs before submitting.

## Runtime contract

The `mcp.directoryProfile` exposes exactly its configured `connectorCatalog` actions at `/mcp/directory`. It rejects missing actions and incomplete MCP annotations, ignores full-catalog requests, omits generic cross-app actions and `tool-search`, and only allows calls to the advertised set. The three booleans are declared on each action: `readOnlyHint`, `destructiveHint`, and `openWorldHint`.

The directory profile forces MCP App resources on for callers of `/mcp/directory`; the existing `/mcp` catalog and instructions remain unchanged. ChatGPT directory widgets use `window.openai`, with the built-in MCP Apps bridge as the fallback, so they need no CDN bundle or self-hosted copy of the bridge. If both host bridges fail, the widget reports the error. Directory mode disables the remote `esm.sh` fallback and omits that origin from its widget CSP. The general `/mcp` endpoint retains its pinned `@modelcontextprotocol/ext-apps@1.7.5` fallback for clients that need it. Each app uses its own request origin for widget metadata and CSP. The OpenAI dashboard also asks for an iframe justification; use the text in the app’s source manifest under `chatgpt.review.iframeJustification`.

The core route `GET /.well-known/openai-apps-challenge` returns the configured `OPENAI_APPS_CHALLENGE_TOKEN` as uncached plain text. It returns 404 while the token is unset. Set the value on the matching app deployment and redeploy before rescanning the domain in OpenAI’s dashboard.

## Before submitting

Use OpenAI’s [submission guide](https://developers.openai.com/plugins/deploy/submission), [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines), and [tool and UI reference](https://developers.openai.com/plugins/reference).

Confirm PR #6542 is merged and the Slides, Design, and Content deployments are promoted before continuing. Then confirm the organization’s project residency is eligible for MCP plugin submissions and complete the following in order for each app:

1. Verify the publisher and confirm its identity matches `developerName` in the source manifest. The manifests currently use `Agent-Native`; update the name and rebuild the ZIP if the verified identity differs.
2. Have an organization owner grant the submitting account `api.apps.write` access.
3. Upload the draft ZIP.
4. Connect its MCP server at the app’s `/mcp/directory` URL and complete the dashboard’s OAuth setup.
5. Set the challenge token issued for that app and domain as `OPENAI_APPS_CHALLENGE_TOKEN` on that app’s deployment, then redeploy it.
6. Rescan the domain and confirm its public challenge URL returns the exact token.
7. Add a reviewer account with password-based sign-in and no inaccessible MFA. Enter its credentials only in the dashboard’s secure form.
8. Run all eight review cases on ChatGPT web and mobile. Confirm account boundaries, saved artifacts, no unsupported external edits, and widget rendering. Seed exactly the records below; prompts and expected behavior must not assume additional data.
9. Record a reviewer-accessible walkthrough for the app. Add its URL to `chatgpt.review.demo_recording_url`, rebuild the ZIPs, and upload the refreshed package. The walkthrough should show connection and auth, a direct creation request, a revision or read flow, the saved artifact, and the supported-scope boundary.
10. Submit the completed listing for review. Complete any policy attestations and wait for the review decision.
11. After approval, select country availability and publish in the dashboard.

Seeded records guaranteed for review:

- **Slides:** `Quarterly Planning Demo` with a `Priorities` slide.
- **Design:** `Northstar Brand`, `Product Launch Demo`, and one available template. The template’s name and type are not fixed.
- **Content:** `Launch Brief Demo` containing `early access`, and a `Feature Requests Demo` database. Its schema and entries are not fixed.

The package generator writes the current portal order and iframe explanations into `.tmp/chatgpt-plugin-submissions/SUBMISSION.md`. Reviewer credentials and secrets never belong in the ZIPs or repository.

## Distribution expectations

Use app-specific task language in the title, subtitle, description, and starter prompts. Keep tool names and descriptions close to user goals such as “make a presentation,” “prototype a checkout flow,” or “revise this project brief.” The metadata can help ChatGPT recognize a fit, but there is no setting that guarantees an organic recommendation or invocation. Track discovery and completion after launch, then update the listing from real prompt and support feedback.

The project’s license is unresolved. The root package metadata currently says ISC, but the repository has no root `LICENSE` file and the licensing decision has not been confirmed. Do not describe these listings as open source, ISC, MIT, free, or under another specific license until that decision is resolved.
