---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

CLI + dispatch shell fixes from create-workflow feedback:

- `create`: scaffold `packages/pinpoint` when the user selects `slides` or
  `videos`. Their `package.json` declares `@agent-native/pinpoint:
workspace:*`, but the templates-meta entries were missing
  `requiredPackages: ["pinpoint"]`, so `pnpm install` blew up with
  `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The existing e2e test now covers all
  templates that declare `@agent-native/*` workspace deps so a regression
  surfaces in CI instead of on the user's machine.
- `create`: per-template progress messages during scaffolding (`Scaffolding
Slides (3/4)...`, `Adding shared packages...`) and a concrete "this is
  done" stop message, replacing the single static "Working... no action
  needed" line that made a multi-app workspace feel hung.
- `create`: detect `pnpm` on PATH before printing the outro. If it's
  missing, the next-steps block now leads with `npm install -g pnpm`
  instead of dumping the user at `zsh: command not found: pnpm`.
- `DispatchShell`: page-title info icon now opens a click-driven Popover
  instead of a hover-only Tooltip. Clicking the icon (the natural gesture)
  did nothing on touch devices and confused users on desktop too.
