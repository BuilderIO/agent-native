# ChatGPT Plugin Directory

This repository prepares three focused ChatGPT plugins: Slides, Design, and Content. Each listing connects to one app’s hosted MCP endpoint and exposes a curated action set. The portable Agent Plugins package format supports multiple MCP servers, but separate listings make the task description, authorization, review cases, and app destination clear for each use case.

The public `/apps/*` descriptions are the starting point for listing copy. ChatGPT’s metadata limits require shorter subtitles, and each long description names the supported tasks and the current connector’s boundaries. Listing metadata and review cases live in each app’s `agent-native.app-skill.json` under `chatgpt`.

## Build the upload packages

Run:

```sh
pnpm pack:chatgpt-plugins
```

The command validates metadata, review case counts, tool names, icon dimensions, and unique widget origins. It writes three ZIPs and a handoff file to `.tmp/chatgpt-plugin-submissions/`. It will stop if that output directory already exists; choose another `--out` path after changing metadata:

```sh
pnpm pack:chatgpt-plugins -- --out=.tmp/chatgpt-plugin-submissions-next
```

Each ZIP contains only a portable root `plugin.json`, root `mcp.json`, and the app logo under `assets/`. It contains no app source, reviewer login, password, API token, or challenge token. Each `mcp.json` declares one `streamable-http` MCP server at the app’s hosted `/mcp/directory` endpoint.

The ZIPs include five proposed positive and three proposed negative test cases. They have not been executed in ChatGPT yet. A reviewer-accessible `review.demo_recording_url` is required before review submission. After recording, add the URL under `chatgpt.review.demo_recording_url` in the relevant source manifest and generate a new output directory.

## Runtime contract

The `mcp.directoryProfile` exposes exactly its configured `connectorCatalog` actions at `/mcp/directory`. It rejects missing actions and incomplete MCP annotations, ignores full-catalog requests, omits generic cross-app actions and `tool-search`, and only allows calls to the advertised set. The three booleans are declared on each action: `readOnlyHint`, `destructiveHint`, and `openWorldHint`.

The directory profile forces MCP App resources on for callers of `/mcp/directory`; the existing `/mcp` catalog and instructions remain unchanged. If a listed action provides a widget, its metadata uses the app’s request origin for `_meta.ui.domain` and ChatGPT’s compatibility alias. The OpenAI dashboard also asks for a justification when a widget’s CSP allows an iframe; each source manifest stores a prepared justification in `chatgpt.review.iframeJustification`.

The core route `GET /.well-known/openai-apps-challenge` returns the configured `OPENAI_APPS_CHALLENGE_TOKEN` as uncached plain text. It returns 404 while the token is unset. Set the token separately on each app deployment after OpenAI provides the challenge value for that domain.

## Before submitting

Use OpenAI’s [submission guide](https://developers.openai.com/plugins/deploy/submission), [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines), and [tool and UI reference](https://developers.openai.com/plugins/reference).

1. Confirm the OpenAI organization’s verified publisher identity. The manifests currently use `Agent-Native` for `developerName`; update it if the verified identity uses a different name, then rebuild the ZIPs. The directory publisher label comes from the verified identity.
2. Confirm the organization’s project residency is eligible for MCP plugin submissions and that an owner grants the submitting account `api.apps.write` access.
3. Add each app’s hosted MCP URL to the OpenAI developer dashboard, configure OAuth, and set the exact challenge token on that app deployment. Verify the public challenge endpoint returns the exact token.
4. Create a reviewer account with a password-based sign-in and no inaccessible MFA. Enter reviewer credentials only in the dashboard’s secure form. Seed and validate these records:
   - **Slides:** `Northstar Brand` design system and `Quarterly Planning Demo` deck, including a `Priorities` slide.
   - **Design:** `Northstar Brand` design system and `Product Launch Demo` prototype. Keep a template available for the template-based test.
   - **Content:** `Launch Brief Demo` document containing the phrase `early access`, and a `Feature Requests Demo` database.
5. Connect each plugin in ChatGPT developer mode. Run all listed positive and negative cases on web and mobile; confirm account boundaries, saved artifacts, no unsupported external edits, and widget rendering. Fix any mismatch before recording.
6. Record one reviewer-accessible walkthrough for each plugin and add each video URL to its source manifest. The walkthrough should show connection/auth, a direct creation request, a revision or read flow, the saved artifact, and the supported-scope boundary.
7. In the dashboard, provide the iframe justification from the corresponding source manifest when requested. Complete policy attestations, review submission, country availability, release notes, and publishing there.

The current dashboard-only gates are publisher verification, `api.apps.write`, reviewer access, challenge token setup, iframe rationale, demo recording, policy attestations, Submit, and Publish. These are intentionally left to the organization owner or authorized submitter.

## Distribution expectations

Use app-specific task language in the title, subtitle, description, and starter prompts. Keep tool names and descriptions close to user goals such as “make a presentation,” “prototype a checkout flow,” or “revise this project brief.” The metadata can help ChatGPT recognize a fit, but there is no setting that guarantees an organic recommendation or invocation. Track discovery and completion after launch, then update the listing from real prompt and support feedback.

Do not claim that listing keywords guarantee recommendations. The root package does not declare a license: this checkout has no root license file, and its root package metadata says ISC, so do not label the listing MIT without resolving the project’s licensing.
