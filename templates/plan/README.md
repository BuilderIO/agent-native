# Plan

Structured visual plan mode for coding agents. Plan turns an ordinary
Codex / Claude Code / Markdown plan into a reviewable document — diagrams,
wireframes, prototype options, annotated code walkthroughs, file trees, comments,
share links, and HTML export.

**Live app: [plan.agent-native.com](https://plan.agent-native.com)**

## Install (recommended)

Most people install Plan as a skill, not a scaffolded app. One CLI command adds
the `/visual-plan` and `/visual-recap` skills plus the hosted Plan connector to
your coding agent:

```sh
npx @agent-native/core@latest skills add visual-plan
```

Then use `/visual-plan` to plan before the agent builds, and `/visual-recap` to
review a change after it lands. Reviewers you share with edit as a guest and sign
in only to save or share.

## Features

- Rich, editable plan blocks: diagrams, wireframes, prototypes, and annotations.
- Annotated code walkthroughs and file trees for code work.
- Reviewer comments, feedback, and private share links.
- `/visual-recap` reverse-plans a PR, commit, branch, or diff for review.
- MDX source sync so plans can be committed to a repo.
- Optional PR Visual Recap GitHub Action.

## Develop locally

Forking the template is the secondary path, for self-hosting or customizing the
Plan app itself:

```bash
npx @agent-native/core@latest create my-plan --standalone --template plan
cd my-plan
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-plan](https://agent-native.com/docs/template-plan).
