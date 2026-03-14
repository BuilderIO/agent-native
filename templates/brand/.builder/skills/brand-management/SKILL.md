# Brand Management

## When to Re-analyze

Run `pnpm script analyze-brand` after:
- New reference images are uploaded
- Multiple reference images are deleted
- The user asks to refresh or update the style profile

## Asset Organization

- Logos go in `data/brand/logos/`
- Style reference images go in `data/brand/references/`
- Brand config (name, colors, fonts) is in `data/brand/config.json`
- Style profile is in `data/brand/style-profile.json`

## Guidelines

- Keep 3-10 reference images for best style consistency
- Suggest removing outlier images that don't match the core style
- After uploading new references, always offer to re-analyze the style profile
