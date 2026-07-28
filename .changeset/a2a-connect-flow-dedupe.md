---
"@agent-native/core": minor
"@agent-native/dispatch": patch
---

Make connecting one agent-native app to another a guided flow instead of three
blank text fields.

- New `GET /_agent-native/agents/probe` reads a peer's agent card and makes one
  authenticated no-op call, reporting `reachable` and `authorized` as
  independent fields. A peer that answers but rejects the caller's token is the
  failure local dev hides — the receiver runs unauthenticated on localhost, so a
  mismatched secret previously surfaced only after deploy.
- Settings → Manage agent → Connected Agents is URL-first: paste a peer URL,
  press Check, and the name and description come from its card. Unreachable
  never blocks the save. Rows carry a liveness dot from one batched probe.
- The section now shows shared-secret state and a Sync to apps action inline,
  reusing the existing org hooks. A caller who cannot see the secret is told so
  rather than being shown "not set".
- After an add, the UI states that registration is one-directional and deep
  links to the peer's own settings with the values prefilled.
- The Connected Agents list collapses a remote agent that still has its
  pre-migration `agents/*.json` row alongside the canonical
  `remote-agents/*.json` one, instead of listing it twice with the same URL.
- `list-connected-agents` keys custom manifests by the normalized agent id, so
  an agent registered as `images`/`asset` no longer appears once as a discovered
  agent and again as a custom one.
- Export `resolveA2ACallerAuth` from `@agent-native/core/a2a` so app code can
  authenticate outbound A2A calls without reimplementing org-secret lookup.
- The `a2a-protocol` skill documents the real setup path — A2A is auto-mounted,
  peers are `remote-agents/*.json` resources, and auth is a JWT signed with
  `A2A_SECRET` or the per-org secret — replacing the `mountA2A` + per-peer
  `apiKeyEnv` flow the framework no longer wires up.
