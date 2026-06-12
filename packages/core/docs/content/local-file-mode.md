---
title: "Local File Mode"
description: "Run agent-native apps with local Markdown, MDX, and other repo files as the source of truth instead of SQL-backed records."
---

# Local File Mode

Local File Mode lets an agent-native app attach its normal UI and action surface
directly to files in a repo or workspace. The app still feels like the hosted
product, but its list views, editor, and agent tools read and write local files
instead of SQL-backed app records.

The first implementation is in the Content template: the left sidebar is
populated from local `.md` and `.mdx` files, selecting a page opens the standard
Content editor, and saving writes back to the selected file. The same files can
also be edited by Codex, Claude Code, the Agent-Native sidebar agent, or a normal
editor.

Use Local File Mode when you want a repo-first workflow:

- a docs repo with `docs/*.mdx`
- a blog with `blog/*.mdx`
- resources such as positioning, messaging, or team notes in `resources/*.md`
- a personal Obsidian-style knowledge base with a richer MDX editor
- app artifacts that should be easy for coding agents to inspect and patch

Use database mode when you want the hosted collaborative app experience:
multi-user sharing, SQL-backed permissions, comments, version history, and
production hosting without local filesystem access.

## The Mental Model

There are two source-of-truth modes:

| Mode            | Source of truth                            | Best for                                                                 |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| Database mode   | SQL rows through Drizzle                   | Hosted apps, collaboration, sharing, comments, version history           |
| Local File Mode | Repo files declared by `agent-native.json` | Local/dev workflows, Git review, coding-agent edits, file-native content |

The UI and agent actions should stay the same shape in both modes. A Content
editor still edits documents; the difference is whether those documents resolve
to SQL rows or local files.

## Example Repo

A Content workspace can be as small as this:

```txt
my-content-repo/
  agent-native.json
  docs/
    getting-started.mdx
    guides/
      custom-components.mdx
  blog/
    launch-post.mdx
  resources/
    messaging/
      positioning.md
  components/
    FrameworkTabs.tsx
    Callout.tsx
```

In Local File Mode, the Content sidebar shows the `docs/`, `blog/`, and
`resources/` trees as pages. Selecting `docs/getting-started.mdx` opens that
file in the standard Content editor; editing in the UI writes back to
`docs/getting-started.mdx`.

`components/` is not a content root. It is a preview component library that MDX
files can import or reference. The editor can render simple local MDX components
without requiring you to clone or fork the entire Content app.

## Configuration

Add `agent-native.json` to the repo or workspace root:

```json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        {
          "name": "Docs",
          "path": "docs",
          "kind": "docs",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Blog",
          "path": "blog",
          "kind": "blog",
          "extensions": [".md", ".mdx"]
        },
        {
          "name": "Resources",
          "path": "resources",
          "kind": "resources",
          "extensions": [".md", ".mdx"]
        }
      ],
      "components": "components",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
```

You can also enable local files with `AGENT_NATIVE_MODE=local-files` or
`AGENT_NATIVE_DATA_MODE=local-files`; the manifest is preferred because it
documents the folder contract in the repo itself.

## Content File Format

Content reads Markdown and MDX. Frontmatter holds page metadata, and the body is
the editable document:

```mdx
---
title: "Getting Started"
icon: "sparkles"
isFavorite: true
updatedAt: "2026-06-12T20:00:00.000Z"
---

# Getting Started

Use <FrameworkTabs value="react" /> to show framework-specific code.
```

The title comes from `title` frontmatter when present, otherwise from the
filename. The editor preserves MDX source that it cannot visually edit yet, so
coding agents and normal text editors remain safe escape hatches.

## Custom MDX Components

Content can preview local components from the configured `components` folder.
This is meant for docs-style MDX components such as tabs, callouts, package
install snippets, or framework-specific code blocks.

Simple component tags with literal props can preview inline:

```mdx
<FrameworkTabs value="react" />

<Callout type="warning">This setting affects production deploys.</Callout>
```

Complex JSX expressions are preserved in source. If the editor cannot safely
preview a component prop yet, it shows a warning placeholder rather than
silently dropping data.

## How Apps Use It

Local File Mode is implemented through the framework's local artifact helpers.
An app declares roots for the artifact types it owns, then reads and writes
through the same action surface its UI and agent already use.

For Content, that means:

- `list-documents` lists configured `.md` and `.mdx` files.
- `get-document` reads a selected local file.
- `update-document` writes the selected local file.
- `create-document` creates a new local `.mdx` file in the selected folder.
- `delete-document` deletes the local file.
- search runs across the configured local files.

Moving, renaming, and reordering local-file pages from the Content UI is not
supported yet. Do those operations in the workspace or with a coding agent; the
Content sidebar will reflect the resulting file tree.

This keeps the agent contract simple: the agent can keep using Content actions,
and those actions decide whether the target is SQL-backed or file-backed.

Other apps can adopt the same pattern over time. A Slides app can map
`slides/*.mdx` to decks, a Plans app can map `plans/*` to plan documents, and a
Dashboards app can map `dashboards/*.mdx` to dashboards. Those app-specific
folders are conventions layered on top of the same local artifact contract.

## Local Files vs. Export/Import

Content has two different file workflows:

| Workflow                     | What happens                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/local-files` export/import | Database mode remains the source of truth. Files are an explicit sync surface you export, edit, preview, and import. |
| Local File Mode              | Files are the source of truth. The Content sidebar and editor operate directly on local files.                       |

Use export/import when you want occasional file review around a hosted workspace.
Use Local File Mode when the repo itself is the workspace.

## History And Collaboration

Local File Mode leans on file-native history:

- commit important changes to Git
- use pull requests for review
- let coding agents edit the same files directly
- use normal file diffs to understand changes

Database mode remains the better fit for hosted collaboration features such as
sharing, comments, SQL-backed version history, and live multi-user editing.

Provider sync can be layered on top of either mode. For example, a docs repo can
add actions that pull content from a CMS into local MDX files or push selected
local files back to that CMS.

## Production Safety

Local File Mode gives app actions direct write access to configured workspace
files. That is appropriate for local development and trusted single-tenant file
bridges, but it is not the default production security model.

When `NODE_ENV=production`, the framework refuses `local-files` mode unless you
set:

```bash
AGENT_NATIVE_ALLOW_LOCAL_FILES_IN_PRODUCTION=true
```

Only set that for a trusted single-tenant deployment where everyone who can use
the app is allowed to read and write the configured files. For normal hosted,
multi-user apps, use database mode and SQL-backed sharing.
