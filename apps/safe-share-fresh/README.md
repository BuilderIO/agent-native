# Safe Share Transcript

Safe Share is a small agent-native app for turning a pasted or uploaded
transcript into a reviewable, safer summary before sharing it.

## Local preview

```bash
cp .env.example .env
# For a local account-free preview, set AUTH_DISABLED=1 in .env.
pnpm install
pnpm dev
```

Open `/share` in the reported local URL. Paste a transcript, choose an
audience, run the local sensitive-content pass, review the original above the
safe summary, and export Markdown or text. “Ask the agent to review” and
“Review with agent” open the contextual right sidebar with the transcript as
bounded hidden context.

Paste and local `.txt`/`.md` uploads work without a provider key. ChatGPT and
Claude conversation imports are intentionally marked coming soon; export or
copy those transcripts and paste them for now.

The committed `agent-native.json` shows Connect AI / BYOK in development and
skips the generic integrations catalog; production builds use the full hosted
integrations step.

The local analyzer is a bounded pattern pass, not a privacy guarantee. It
checks common contact details, links, credential-shaped strings, IP addresses,
and lines marked private or confidential. Review the original before sharing.

## Commands

- `pnpm dev` - start the local preview
- `pnpm typecheck` - run the generated app typecheck
- `pnpm test` - run the app test command
- `pnpm build` - create the production output
