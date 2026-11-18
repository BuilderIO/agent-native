---
"@agent-native/core": minor
"@agent-native/scheduling": minor
---

Add extension points a deployment can register its own policy through, with no change until something registers:

- `fetchWithProviderCallGate` (from `@agent-native/core/provider-api` and `@agent-native/core/provider-api/call-gates`) sends a request made with a package's own client through the registered provider call gates, so a gate refuses, debits or rate-limits it exactly as it would a provider-api request. `precheckProviderCall` takes the request URL when known, so a gate that claims requests by URL is prechecked too, and a caller that must precheck before its own work (such as a token refresh) calls `precheckGatedProviderCall`, which bounds the precheck by the same admission deadline (`ProviderCallGateAdmissionTimeoutError`), and passes the receipt as `prechecked` so it runs once. The scheduling Google Calendar provider sends every request through it as provider `google_calendar`, takes an optional `getAccountIdentity(credentialId)` that gates receive as the request's `accountId` (a lookup that misses the admission deadline arrives as `ProviderAccountLookupTimeoutError` in `accountIdError`), and an optional `appId` (default `"scheduling"`) that gates receive as the consuming app.
- `registerA2AActionCallHook` (from `@agent-native/core/a2a`) lets a hook add JSON-RPC params to outgoing `actions/invoke` calls and, on the receiving app, refuse an incoming call or admit it as foreground work (`isA2AForegroundCall()`), optionally in a verified organization. A refusal reaches the caller as `A2ACallRefusedError`.
- `registerMcpTurnGrantAdmitter` (from `@agent-native/core/mcp`) admits a turn grant the framework's own store does not recognize, such as one another service minted for the user's current turn. An admitted decision names the grant's `ownerEmail` and `appId`, and the framework refuses it unless both match the call. An admitter that does not answer within 5 seconds refuses the grant.
- `defineConfig` client options take `buildId` and `commitSha`, so one build process can compile apps that report different builds.
- `agent-native.json` `doctor.testEnvKeys` lists non-secret env keys an app's tests may read without the `no-env-credentials` guard flagging them; credential-like names (including `*_URI` connection strings, webhooks, passphrases and `JWT`) are refused.
