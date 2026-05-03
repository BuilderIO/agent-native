# Agent-Native Docs

This package builds the public docs site for Agent-Native.

## Source

- App routes and UI live in `app/`.
- Markdown docs are loaded from `../core/docs/content/` by `app/components/docs-content.ts`.
- The left nav is `app/components/docsNavItems.ts`.
- Template landing-page metadata comes from `app/components/TemplateCard.tsx`.
- `scripts/generate-source-index.ts` builds `public/source-index.json` before production builds.
- `app/vite-sitemap-plugin.ts` generates `public/sitemap.xml` during `pnpm build`.

Search is built at runtime from the loaded markdown docs. There is no generated `searchIndex.ts` source file.

## Development

```bash
pnpm --filter @agent-native/docs dev
```

The dev server runs through `agent-native dev` on port 3000.

## Testing

```bash
pnpm --filter @agent-native/docs test
node scripts/guard-template-list.mjs
```

The template-list guard enforces that public template surfaces only include allow-listed templates from `packages/shared-app-config/templates.ts`. The Starter scaffold is CLI-only and should not appear in `/templates` or generic template routes.

## Build

```bash
pnpm --filter @agent-native/docs build
```

Build output goes to the docs package `dist/` directory. The build also refreshes `public/source-index.json` and `public/sitemap.xml`.
