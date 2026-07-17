export const CONTENT_SKILL_MD = `---
name: content
description: >-
  Use Content for repo-backed Markdown/MDX docs, blogs, resources, rich
  document editing, local components, shareable copies, and database-backed
  local-folder sources. Prefer Content actions over raw filesystem writes when
  available.
metadata:
  visibility: exported
---

# Content

Use the Content app when a workflow is about authoring, editing, reviewing, or
publishing Markdown/MDX documents: docs sites, blogs, resource libraries,
marketing pages, internal notes, and local MDX components. Content gives the
agent a document tree, a rich editor, normal document actions, and optional
local-folder synchronization.

## Choose The Path

- Use Content actions when the Content MCP/action tools are available:
  \`list-documents\`, \`search-documents\`, \`get-document\`,
  \`pull-document\`, \`create-document\`, \`edit-document\`,
  \`update-document\`, \`delete-document\`,
  \`sync-manifest-local-folder-source\`, \`sync-local-folder-source\`,
  \`list-local-component-files\`, and \`write-local-component-file\`.
- Use \`pull-document\` or \`get-document\` before editing a page. Use
  \`edit-document\` for precise find/replace changes and \`update-document\`
  for full rewrites or new content.
- Local folders declared in \`agent-native.json\` are sources for ordinary
  SQL-backed Content pages. Use the trusted bridge's pull/check/push workflows to
  synchronize them; normal document actions always operate on the database.
- If Content tools are not visible and no local Content app or Desktop bridge is
  running, treat this skill as repo-editing guidance. Edit configured
  \`.md\`/\`.mdx\` files directly, preserve frontmatter and MDX imports, and tell
  the user the Content action surface was not available.

## Action Examples

Prefer JSON input for action calls:

\`\`\`bash
pnpm action list-documents
pnpm action get-document '{"id":"document-id"}'
pnpm action edit-document '{"id":"document-id","find":"old copy","replace":"new copy"}'
pnpm action update-document '{"id":"document-id","content":"# Updated\\n\\nBody"}'
\`\`\`

Run \`refresh-list\` after create/update/delete operations when you need the
open Content UI sidebar to repaint immediately.

## Local Folder Sources

Install into an existing repo with:

\`\`\`bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
\`\`\`

The installer copies this skill and writes or updates \`agent-native.json\` with
database-backed local-folder sources for \`docs/\`, \`blog/\`, \`content/\`, and
\`resources/\`, plus a \`components/\` folder for local MDX components. A trusted
local bridge imports these files into the workspace's canonical Files database.
Run \`sync-manifest-local-folder-source\` with a root's generated
\`source.connectionId\`, or launch \`agent-native content local-files <target>\`,
to connect and pull it. A typical root looks like:

\`\`\`json
{
  "version": 1,
  "apps": {
    "content": {
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"],
          "source": {
            "type": "local-folder",
            "connectionId": "local-folder:<opaque-id>",
            "truthPolicy": "source_primary"
          }
        }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
\`\`\`

Local-folder synchronization does not make the host language model local, and
the hosted Content app cannot read private repo files by itself. File access
requires a local Content app, Agent Native Desktop, or another trusted bridge.

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

- A database page and its source file can change independently. Use folder
  check/pull/push and resolve reported conflicts rather than silently overwriting
  either revision.
- Do not push/pull Notion, Builder.io, or other provider-backed content unless
  the user explicitly asks for provider sync.
- Do not paste secrets, private provider data, or credential-looking values into
  docs, generated pages, frontmatter, examples, or local components.
`;
