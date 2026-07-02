# Content

Open-source Obsidian for MDX — an agent-native, local-file document workspace and
a self-hostable alternative to Notion and Obsidian. Edit local Markdown/MDX files,
build Notion-style databases, and write with an AI agent.

**Live app: [content.agent-native.com](https://content.agent-native.com)**

Open a doc and ask "rewrite this paragraph to be more concise" or "create a page
called Q4 Planning with sub-pages for Goals, Metrics, and Risks" — the same result
whether you do it yourself or ask. Documents can live in your SQL database or as
local Markdown/MDX files.

## Features

- Rich-text editor (Tiptap) with slash commands and hierarchical pages.
- Notion-style databases with table, board, calendar, gallery, and timeline views.
- Local Markdown/MDX file editing plus custom interactive MDX components.
- Inline comments, version history, and full-text search.
- Private-by-default sharing with per-user / per-org grants and public pages.
- Optional Notion and Builder.io sync.

## Develop locally

Scaffold your own copy and run it:

```bash
npx @agent-native/core@latest create my-content --standalone --template content
cd my-content
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-content](https://agent-native.com/docs/template-content).
