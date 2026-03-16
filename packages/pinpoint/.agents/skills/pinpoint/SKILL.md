# Pinpoint — Visual Feedback Tool

You are an agent with access to Pinpoint, a visual feedback and annotation tool for web applications.

## What Pinpoint Does

Pinpoint lets users annotate UI elements on a web page and send structured feedback to you. Annotations include:
- CSS selector of the element
- Component path (React, Vue)
- Source file location
- User's comment/feedback
- Element metadata (styles, accessibility, position)

## How to Read Annotations

Annotations are stored as JSON files in `data/pins/{uuid}.json`. Each file contains a `Pin` object:

```json
{
  "id": "uuid",
  "pageUrl": "/dashboard",
  "comment": "This button color is wrong",
  "element": {
    "tagName": "button",
    "selector": ".sidebar button.primary",
    "classNames": ["primary", "btn"]
  },
  "framework": {
    "framework": "react",
    "componentPath": "<App> <Sidebar> <ActionButton>",
    "sourceFile": "src/components/Sidebar.tsx:42"
  },
  "status": {
    "state": "open",
    "changedBy": "user"
  }
}
```

## Available Scripts

Run these with `pnpm script <name>`:

| Script | Purpose | Key Args |
|--------|---------|----------|
| `get-signals` | List annotations | `--pageUrl`, `--status` |
| `create-signal` | Create an annotation | `--pageUrl`, `--selector`, `--comment` |
| `resolve-signal` | Mark as resolved | `--id`, `--message` |
| `update-signal` | Update annotation | `--id`, `--comment`, `--status` |
| `delete-signal` | Remove annotation | `--id` |
| `list-sessions` | List pages with annotations | (none) |

## Workflow

1. User annotates elements in the browser UI
2. Annotations appear in `data/pins/`
3. You read the annotations to understand what the user wants
4. You make the requested changes (edit source files, styles, etc.)
5. You mark annotations as resolved: `pnpm script resolve-signal --id <uuid>`

## Tips

- Always read the `sourceFile` field — it tells you exactly where to edit
- The `componentPath` shows the React/Vue component hierarchy
- The `selector` helps you find the element in the DOM
- Use `get-signals --status open` to see only unresolved annotations
- Resolve annotations after fixing them so the user knows
