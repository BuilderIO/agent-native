export const CONTENT_SKILL_MD = `---
name: content
description: >-
  Use Content for repo-backed Markdown/MDX docs, blogs, resources, rich
  document editing, local components, shareable copies, and Content local-file
  workspaces. Prefer Content actions over raw filesystem writes when available.
metadata:
  visibility: exported
---

# Content

Use the Content app when a workflow is about authoring, editing, reviewing, or
publishing Markdown/MDX documents: docs sites, blogs, resource libraries,
marketing pages, internal notes, and local MDX components. Content gives the
agent a document tree, a rich editor, normal document actions, and optional
local-file source of truth.

## Choose The Path

- Use Content actions when the Content MCP/action tools are available:
  \`list-documents\`, \`search-documents\`, \`get-document\`,
  \`pull-document\`, \`create-document\`, \`edit-document\`,
  \`update-document\`, \`delete-document\`, \`share-local-file-document\`,
  \`list-local-component-files\`, and \`write-local-component-file\`.
- Use \`pull-document\` or \`get-document\` before editing a page. Use
  \`edit-document\` for precise find/replace changes and \`update-document\`
  for full rewrites or new content.
- In Local File Mode, Content actions read and write the repo files declared in
  \`agent-native.json\`; SQL remains cache/history/search glue, not the source of
  truth for those pages.
- If Content tools are not visible and no local Content app or Desktop bridge is
  running, treat this skill as repo-editing guidance. Edit configured
  \`.md\`/\`.mdx\` files directly, preserve frontmatter and MDX imports, and tell
  the user the Content action surface was not available.

## Action Examples

Prefer JSON input for action calls:

\`\`\`bash
pnpm action list-documents
pnpm action get-document '{"id":"local-file:..."}'
pnpm action edit-document '{"id":"local-file:...","find":"old copy","replace":"new copy"}'
pnpm action update-document '{"id":"local-file:...","content":"# Updated\\n\\nBody"}'
pnpm action share-local-file-document '{"id":"local-file:..."}'
\`\`\`

Run \`refresh-list\` after create/update/delete operations when you need the
open Content UI sidebar to repaint immediately.

## Local File Mode

Install into an existing repo with:

\`\`\`bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
\`\`\`

The installer copies this skill and writes or updates \`agent-native.json\` with
Content roots for \`docs/\`, \`blog/\`, \`content/\`, and \`resources/\`, plus a
\`components/\` folder for local MDX components. A typical manifest looks like:

\`\`\`json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        { "name": "Docs", "path": "docs", "kind": "docs", "extensions": [".md", ".mdx"] },
        { "name": "Blog", "path": "blog", "kind": "blog", "extensions": [".md", ".mdx"] },
        { "name": "Content", "path": "content", "kind": "content", "extensions": [".md", ".mdx"] },
        { "name": "Resources", "path": "resources", "kind": "resources", "extensions": [".md", ".mdx"] }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
\`\`\`

Local File Mode does not make the host language model local, and the hosted
Content app cannot read private repo files by itself. File access requires a
local Content app, Agent Native Desktop, or another trusted local bridge.

## MDX And Components

- Preserve frontmatter keys you do not understand. Preserve MDX imports,
  exports, JSX, and expression props unless the user explicitly asks to change
  them.
- Use local components from the configured \`components\` folder. Components
  should be PascalCase exports from \`.tsx\` files; simple editable input metadata
  can live next to them as \`ComponentNameInputs\`.
- Use \`list-local-component-files\` and \`write-local-component-file\` for
  component source changes when Content tools are available. Otherwise edit the
  component files directly like normal repo source.

## Boundaries

- Moving, renaming, and reordering local-file pages are not first-class Content
  UI operations yet. Use normal file operations when the user asks for those,
  then let Content rediscover the file tree.
- Do not push/pull Notion, Builder.io, or other provider-backed content unless
  the user explicitly asks for provider sync.
- Do not paste secrets, private provider data, or credential-looking values into
  docs, generated pages, frontmatter, examples, or local components.
`;
