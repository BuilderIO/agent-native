# Contributing to Agent-Native

Agent-Native is MIT-licensed. Fork it, build on it, and send your changes back. This page covers how.

## What's welcome

- Bug fixes in the framework packages (`packages/`) or the template apps (`templates/`).
- Improvements to the template apps. If you made the change in an app you created from a template, `pnpm contribute:template --app <path-to-app> --dry-run` helps port it back into `templates/<name>/`. See [Syncing Template Changes](https://agent-native.com/docs/syncing-template-changes?utm_source=github&utm_medium=referral&utm_content=contributing#contributing-changes-back).
- Docs fixes. The docs source lives in `packages/core/docs/content/`.
- Community templates. These live in your own public GitHub repo, not this one, and anyone can install yours with `npx @agent-native/core@latest create my-app --template community:owner/repo`. To get it listed, open an issue with the repo URL, a one-sentence description, the maintainer and license, the command you tested, and a demo link if you have one. [Community templates](https://agent-native.com/docs/cloneable-saas?utm_source=github&utm_medium=referral&utm_content=contributing#community-templates) covers what a listed template needs.

Bug fixes and small improvements that follow the patterns already in the code can go straight to a PR. Open an issue first if your change adds a new public API (an export, config option, action, plugin or hook contract, or CLI command in a published package) or makes a bigger product call. Those need a maintainer's go-ahead before review, so agree on the shape before you build it.

Report bugs and propose ideas in [issues](https://github.com/BuilderIO/agent-native/issues). Ask questions and show what you're building in [Discord](https://discord.gg/qm82StQ2NC).

## Setup

[DEVELOPMENT.md](./DEVELOPMENT.md) covers prerequisites, install, running a template, and the Git settings the guards need on Windows.

## Coding agents

This repo is built for coding agents. [AGENTS.md](./AGENTS.md) is their guide, and `.agents/skills/` holds the detailed rules for each area. Point your agent at both. The shipping and deploy workflows in there are for maintainers. From a fork, push your branch and open a PR.

Agent-written PRs are held to the same bar as any other. A person who understands the change has to stand behind it: read the diff, run it, and answer review questions.

## Before you open a PR

Run the full local check from the repo root. It formats, typechecks, and runs the fast tests and the guards:

```bash
pnpm run prep
```

Then run the tests for the area you changed:

```bash
pnpm --filter mail test
pnpm --filter @agent-native/core test
```

A bug fix should come with a test that fails without the fix.

Depending on what you touched:

- **Published packages.** If you changed source in a published package under `packages/`, add a changeset with `pnpm changeset add`. CI fails without one. Use `patch` or `minor`. Major bumps are blocked.
- **Template apps.** Most apps keep a user-facing changelog (their `agent-native.config.ts` sets `changelog: { enabled: true }`). If users of that app would notice your change, add an entry from the app's folder, for example `pnpm exec agent-native changelog add "Fixed a crash when opening an empty folder" --type fixed`. The type is `added`, `improved`, or `fixed`. Skip it for refactors, tooling, and tests.
- **UI text and docs.** English UI strings live in each app's `app/i18n/en-US.ts`. When you change one, update the same key in every other locale file the app ships. When you change docs in `packages/core/docs/content/`, update the matching files under `packages/core/docs/content/locales/`. A machine translation is a fine starting point. `pnpm guard:i18n-catalogs` and `pnpm guard:i18n-changed-copy` check both.

## Opening the PR

- Keep it small and focused on one change.
- Say what was wrong and what you changed, and link the issue if there is one.
- Add screenshots or a short recording for UI changes. Hosted previews only build for branches in this repo, so reviewers rely on what you show them.
- Leave **Allow edits by maintainers** on.
- Open it as ready for review. Drafts don't enter the review queue.

CI runs the same required checks on a fork PR as on any other. On your first PR here, GitHub may hold the CI run until a maintainer approves it. The visual recap job skips fork PRs unless a maintainer adds the `recap` label.

## What happens next

1. An automated reviewer may comment on the PR. Fix what's real in your change, and reply when you think a finding is wrong.
2. A Builder.io developer takes the PR and reads the full diff. A new public API or a bigger product call waits for a maintainer's go-ahead first.
3. They'll merge it, ask for changes (usually one at a time), or finish small things on your branch themselves. If the right fix looks quite different, they may rebuild it in a new PR on top of your commits, with you credited. If it isn't a fit, you'll hear why.
4. You don't need to rebase, fix conflicts caused by `main` moving, or rerun flaky jobs. Maintainers merge `main` into your branch instead of rebasing it.
5. PRs are squash-merged. You stay the author, and anyone who pushed to your branch is added as a co-author.

If a PR goes quiet after a request for changes, a maintainer may finish it on your branch. After about a month of silence you'll get one ping, and then it's closed. You're welcome to pick it back up later.

## License

There's no CLA. By contributing, you agree that your contribution is licensed under the [MIT License](./LICENSE) that covers this repo, the same terms you got it under.

## Security

Don't report vulnerabilities in public issues, PRs, or Discord. Use [private vulnerability reporting](https://github.com/BuilderIO/agent-native/security/advisories/new) as [SECURITY.md](./SECURITY.md) describes.
