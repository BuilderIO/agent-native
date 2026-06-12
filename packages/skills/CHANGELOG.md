# @agent-native/skills

## 0.2.1

### Patch Changes

- a784d3c: Keep the default add/list flows and public-repo-backed app skills on the live BuilderIO skills collection instead of delegating them to the app-backed core picker.
- a784d3c: Default app-backed skill setup to all supported clients, clarify Plan MCP auth as per-client, and make reconnect output name which local agent configs were actually refreshed.
- a784d3c: Update user-facing `npx` guidance to recommend explicit `@latest` package invocations.

## 0.2.0

### Minor Changes

- d77a37f: Add best-effort install-funnel analytics to both skills CLIs (`npx @agent-native/skills@latest` and `npx @agent-native/core@latest skills`). Each run reports a step-by-step funnel — started, skills prompted, skills selected, clients selected, scope selected, install completed, MCP registered, connect, and completed/failed/cancelled — to the first-party Agent Native Analytics endpoint, so install volume, skill selection, and step-by-step dropoff can be measured. Events carry a stable per-machine install id (unique installs) and a per-run id (dropoff) and never include paths, repo names, or other identifying data. Telemetry is fire-and-forget, flushes before exit, and is opt-out via `DO_NOT_TRACK=1` or `AGENT_NATIVE_TELEMETRY_DISABLED=1`.
- d77a37f: Unify the two skills installers onto one codebase + UX.
  - `npx @agent-native/skills@latest add` / `list` now delegate to `@agent-native/core`'s
    clack-based installer (`runSkills`, newly exported at `@agent-native/core/cli/skills`),
    so the standalone CLI and `agent-native skills` share the exact same interactive
    experience, MCP-server registration, and authentication. A `AGENT_NATIVE_SKILLS_DIRECT`
    env guard keeps core's plain-repo delegation from looping back.
  - `agent-native skills add`: the optional PR Visual Recap GitHub Action is now offered
    **before** any install/registration, with copy that explains it's a GitHub Action and
    what it does. The final summary is rendered with clack (a boxed note + a "✅ All set!"
    outro that points you at the new slash command and a reload).

### Patch Changes

- d77a37f: Long-lived MCP OAuth tokens and lightweight reconnect command.
  - Access tokens are now long-lived (30-day default, env-overridable) with a
    sliding 365-day refresh window, so random 401s after one hour are eliminated.
  - Audience and signing-secret verification tolerances have been tightened to
    prevent spurious auth failures on host-drift or MCP URL variations.
  - `reconnect` command now detects any agent-native MCP config entry whose URL
    ends in `/_agent-native/mcp` for the given host, matching by URL regardless
    of connector name — no more breakage when the entry is named `plan` vs
    `agent-native-plans`.
  - Installs no longer write duplicate alias entries and clean up existing
    duplicates on the next connect or skills-add run.
  - All CLI, server, skill, and docs guidance now uses `npx @agent-native/core@latest reconnect <app-url>`
    as the documented one-line reauth path and consistently teaches that
    reinstalling from scratch is never needed to fix auth.

- d77a37f: Add built-in app connection support, MCP config writers, and install telemetry for the skills CLI.

## 0.1.1

### Patch Changes

- 7ee8be6: Prompt for install scope (project vs user) during interactive installs when
  `--scope`/`-g`/`--project` is not passed, instead of silently defaulting to
  user scope. Explicit flags and non-interactive runs are unchanged.

## 0.1.0

### Minor Changes

- 3c1d3eb: Add the `@agent-native/skills` installer CLI for plain Codex/Claude skill repos and let `agent-native skills add` delegate public skill repositories like `BuilderIO/skills` to it.
