# Ejecting `@agent-native/scheduling`

For full customization, you can move the package source into your own repo.

**Planned for v0.2:** `agent-native eject @agent-native/scheduling`.

**Today (v0.1)** — do it manually:

1. `cp -r node_modules/@agent-native/scheduling/src packages/scheduling-local/src`
2. Add `packages/scheduling-local/` to your workspaces.
3. Replace `"@agent-native/scheduling": "^0.1"` in dependencies with
   `"@local/scheduling": "workspace:*"` (or similar).
4. Run a find/replace across your repo from `@agent-native/scheduling` to
   `@local/scheduling`.
5. Install: `pnpm install`.

Now you own the code and can modify freely. Upstream updates are available via
`npm view @agent-native/scheduling versions` — you can selectively port changes.
