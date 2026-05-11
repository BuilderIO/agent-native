---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

CLI + dispatch shell fixes from create-workflow feedback:

- `create`: scaffold `packages/pinpoint` when the user selects `slides` or
  `videos`. Their `package.json` declares `@agent-native/pinpoint:
workspace:*`, but the templates-meta entries were missing
  `requiredPackages: ["pinpoint"]`, so `pnpm install` blew up with
  `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The existing e2e test now covers
  every template with `@agent-native/*` workspace deps so a regression
  surfaces in CI instead of on the user's machine.
- `create`: per-template progress messages during scaffolding
  (`Scaffolding Slides (3/4)...`, `Adding shared packages...`) and a
  concrete "this is done" stop message, replacing the single static
  "Working... no action needed" line that made a multi-app workspace
  feel hung.
- `create`: detect `pnpm` on PATH before printing the outro. If it's
  missing, the next-steps block now leads with `npm install -g pnpm`
  instead of dumping the user at `zsh: command not found: pnpm`.
- `create`: Dispatch is now always scaffolded into a new workspace
  rather than being a recommended-but-optional pick. The picker only
  lists the optional apps; the workspace note explains that Dispatch is
  always included as the control plane. `--template=forms` (or any
  non-Dispatch list) still works — Dispatch gets unioned in. New
  regression test asserts this.
- Auth guard: local-dev convenience for `NODE_ENV=development`. When
  the `user` table has no real users yet, the first unauthenticated
  page GET transparently signs up (and signs in) a `dev@local` account
  and 302s back to the requested URL, instead of showing the sign-up
  form. A developer running `pnpm dev` lands straight in the app. Once
  any real account exists the auto-create short-circuit fires and the
  regular login flow takes over. Opt out with
  `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`. Production is unaffected.
- `DispatchShell`: page-title info icon is now a click-driven Popover
  instead of a hover-only Tooltip, and the trigger button has a
  proper hover background so it reads as clickable. Clicking the icon
  (the natural gesture, and the only available one on touch) did
  nothing before.
- `create`: clean up the partially-scaffolded directory when scaffolding
  fails (e.g. flaky network during the template download). Without this
  the first failure left the workspace dir on disk, and the next
  `agent-native create <name>` rejected the same name with "Directory
  already exists" — forcing a manual `rm -rf` before retrying.
- Dispatch apps list: filter dotfile directories (e.g.
  `.agent-native-tmp-*` extraction sidecars) when reading the
  workspace's `apps/` directory. The temp dir is a sibling of the
  target so it appeared at the top of the apps grid mid-scaffold,
  looking like a stray entry.
- Dispatch onboarding: register a "Create your first app" step at order
  5 so it sits above the Slack/Telegram secret-onboarding steps. A
  brand-new workspace was leading with "Connect Slack" before the user
  had even added an app, which felt confusing.
- Agent system prompt (chat-in-browser-on-localdev): when a user asks to
  scaffold a new workspace app from a localhost browser tab, point them
  at \`npx @agent-native/core add-app\` first since they're already in
  that terminal. The desktop / Claude Code / Codex / Builder.io
  alternatives still follow for general source-editing work.
