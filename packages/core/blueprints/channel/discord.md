# Blueprint: add a Discord inbound channel adapter

You are a coding agent working inside an **agent-native** app (a repo built on
`@agent-native/core`). Apply this blueprint as real source changes on the
current branch. Do not just describe the work — do it, then verify.

## Goal

Let users talk to the agent from Discord: a Discord message hits a webhook, the
framework enqueues the work, returns `200` fast, and a fresh function execution
runs the full agent loop and posts the reply back. You implement a
`PlatformAdapter` for Discord that slots into the existing integration-webhooks
pipeline — you do **not** invent a new transport.

## Read first

Read the `integration-webhooks` skill end to end. The non-negotiable shape: the
webhook handler **enqueues to SQL and returns 200 immediately**, then a
self-fired POST runs the agent loop in a separate execution. Never run the agent
loop inside the webhook handler; never rely on fire-and-forget `Promise`s after
returning (serverless freezes the context).

Study the existing adapters as the pattern to copy:

- `packages/core/src/integrations/types.ts` — the `PlatformAdapter`,
  `IncomingMessage`, `OutgoingMessage` contracts.
- `packages/core/src/integrations/adapters/slack.ts` — the closest analog
  (signature verification, parsing, response delivery).
- `packages/core/src/integrations/adapters/telegram.ts` — a simpler reference.
- `packages/core/src/integrations/plugin.ts` → `getDefaultAdapters()` — where
  built-in adapters are registered into the route pipeline.

## Files to touch

1. **`packages/core/src/integrations/adapters/discord.ts`** — implement
   `discordAdapter(): PlatformAdapter`:
   - `platform = "discord"`, `label = "Discord"`.
   - `getRequiredEnvKeys()` — declare `DISCORD_PUBLIC_KEY` (signature
     verification) and `DISCORD_BOT_TOKEN` (sending), with UI hints so the
     settings form renders them. Use obviously-fake placeholders in any docs.
   - `handleVerification(event)` — answer Discord's `PING` interaction
     (`type: 1`) with a `PONG` (`type: 1`).
   - `verifyWebhook(event)` — verify the Ed25519 `X-Signature-Ed25519` /
     `X-Signature-Timestamp` headers against `DISCORD_PUBLIC_KEY`. Fail closed.
   - `parseMessage(event)` — map the interaction/message payload into a
     normalized `IncomingMessage` (set `externalThreadId` to the channel/thread
     id, `text`, `senderName`, `platformContext` with what you need to reply).
     Return `null` to ignore bot messages and non-message events.
   - `sendResponse(...)` — POST the agent reply back via the Discord API using
     `DISCORD_BOT_TOKEN`, read at send time from the secret store.
2. **Register it** in `getDefaultAdapters()` in
   `packages/core/src/integrations/plugin.ts` alongside `slackAdapter()` etc.
3. **Add `discord.spec.ts`** next to the adapter mirroring `slack.spec.ts`:
   cover signature verification (valid + tampered), the PING/PONG verification
   path, message parsing, and bot-message filtering.

## Framework rules to honor

- Do the minimum in the webhook handler; the agent loop runs in the
  `_process-task` execution with its own timeout budget. Don't change that flow.
- `senderVerified` must reflect real cryptographic sender authentication. Never
  derive a privileged acting identity from an unverified sender — fail closed.
- Never hardcode the bot token, public key, or signing secret in source, tests,
  or fixtures. Use placeholders and read real values from the secret store.
- This is a publishable `packages/core` source change → add a `.changeset/*.md`.

## Verify

1. `tsc --noEmit` for `@agent-native/core` passes.
2. `discord.spec.ts` passes (`vitest --run src/integrations/adapters/discord`).
3. End-to-end smoke: send a signed test interaction to
   `/_agent-native/integrations/discord/webhook`; confirm a `200` returns
   immediately, a task is enqueued, the processor runs the agent loop, and a
   reply is delivered. A tampered signature must be rejected.
