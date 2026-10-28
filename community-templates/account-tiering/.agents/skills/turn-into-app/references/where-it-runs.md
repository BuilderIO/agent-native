# Where the app runs

On an interactive local host, ask this once, after the brief and App design
are shown (step 2) and before any install, scaffold, or setup command. The rest
of the run decides and proceeds; this is its one planned question, because the
person should choose between setting things up and making an account.

## When to skip it

- **Browser host.** Builder is the only route: make the Dispatch handoff in
  [the browser-host guide](fresh-project.md).
- **The person already chose.** "Build it here", "run it locally", or "host it
  on Builder" all count. A named route wins over the other skip rules except
  Local File Mode. It picks where the app runs, not what data may be sent.
- **The target is already an Agent-Native workspace** (a parent `package.json`
  has `agent-native.workspaceCore`) and no route was named. Build on this
  machine, inside that workspace.
- **Resuming.** Keep the route the earlier run took.
- **Files on this machine are the source of truth** (Local File Mode). Builder
  can't reach them, so build here even if the person asked for Builder, and
  say why.
- **Headless, with no route named.** Build on this machine, and say in the
  report that nobody was there to ask where it should run.

## The question

First run `node --version` and `pnpm --version`. They only read; install
nothing before the answer. Then ask with the host's question tool, or end the
message with the question. Put your recommendation first, with one sentence on
why, and use these labels:

- **On your machine.** Some setup: Node.js 22.22 or newer and pnpm (name the
  ones that are missing). The app runs from this folder while the computer is
  on. In Claude Cowork, add that the person starts it from their own terminal,
  since Cowork can't keep it running.
- **Hosted with Builder.** Nothing to install, just a free Builder account.
  The brief and the source files it uses are sent to Builder, which builds the
  app and hosts it online. The free plan has a daily credit limit.

Recommend **Hosted with Builder** in Claude Cowork, or when Node.js 22.22+ or
pnpm is missing. Otherwise recommend **On your machine**.

## On your machine

Continue with step 3. If Node.js or pnpm is missing, say what to install (the
installer from nodejs.org; `corepack enable` for pnpm, which ships with
Node.js) and continue once both answer. The final report ends with how to
change the app: ask this agent, in this folder. On localhost the app's own
agent can't edit its code.

## Hosted with Builder

Make the Dispatch handoff in [the browser-host guide](fresh-project.md), with
files per [the attachment reference](attachments.md). Two things differ on a
local host:

- Attach the source files the brief relies on from disk, verbatim, instead of
  from context. A workbook still goes as a bounded CSV rendering. Never attach
  `.env` files, keys, tokens, or other credentials, even when the source uses
  them; name what the app will need instead. If a file holds customer or
  personal data (contact details, financial or health records) or anything the
  source marks internal, confidential, or restricted to one role
  ([source-brief.md](source-brief.md)), sending it to Builder needs the
  person's authorization, even when they named Builder, so the ask-once rule
  in SKILL.md applies: ask before the handoff and offer to leave it out. In a
  headless run nobody can authorize it, so leave it out. The report names what
  was left out.
- Run nothing for the app: no `npm`, `pnpm`, scaffold, or dev server. The only
  commands allowed are the Dispatch connector setup below.

A handoff leaves nothing in this folder, so the resume check can't see one. If
this thread already shows a handoff for the same source, give that result and
ask before sending another: a second handoff makes a second app.

If `start-workspace-app-creation` is missing or Dispatch is not signed in, say
so and offer two ways on:

1. Connect Dispatch. If it is not configured, run
   `npx @agent-native/core@latest connect https://dispatch.agent-native.com`
   with `--client` set to this host. Without Node.js 22.22+, don't make the
   person install it just to pick Builder: send them to
   `https://dispatch.agent-native.com/mcp/connect`, which has steps for each
   host. If it is configured but signed out, sign in from the host's MCP
   settings (in Claude Code, `/mcp`, then Authenticate); for Codex or Cowork,
   run the same command with `reconnect` in place of `connect`. The person
   restarts the agent and runs `/turn-into-app` again with the same source,
   saying to host it on Builder so the question is skipped.
2. Build on this machine instead.

Never fall back to a local build without asking, and never claim the app
exists. The report says what Dispatch returned, as the browser-host guide
describes, and that changes happen in Builder, where the app's code lives,
not in this folder.
