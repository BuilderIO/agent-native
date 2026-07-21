---
name: slide-images
description: Image generation workflow -- generate-image, search-images, and search-logos actions. Style reference patterns.
---

# Slide Images

Images for slides are generated or sourced via three scripts. The agent delegates image generation through the agent chat for conversational follow-up.

## Scripts

| Script | Purpose | Example |
|--------|---------|---------|
| `generate-image` | Generate images (Gemini/OpenAI/auto) | `pnpm action generate-image --prompt "hero image" --model auto --count 3` |
| `search-images` | Search Google Images via the configured provider | `pnpm action search-images --q "Acme logo transparent" --count 5` |
| `search-logos` | Resolve company domains and canonical logo URLs | `pnpm action search-logos --q "Acme"` |
| `image-gen-status` | Check configured image providers | `pnpm action image-gen-status` |

## Image Generation Flow

The standard workflow for generating slide images:

1. User clicks "Image" in the editor or asks the agent
2. Agent runs `pnpm action generate-image --prompt "..." --count 3`
3. Agent shows variations to the user in chat
4. User picks a favorite
5. Agent writes the chosen image into the slide content
6. User can follow up: "make it darker", "try a different angle"

### generate-image Options

```
--prompt              Image description (required)
--model               Provider: gemini | openai | auto (default: auto — tries both)
--slide-content       HTML content of the current slide
--deck-id             Deck ID to load full deck text as context
--slide-id            Slide ID within the deck
--reference-image-urls  Comma-separated URLs of extra reference images
--count               Number of variations (default: 1)
--output              Output file path prefix
```

Default style reference images from `shared/api.ts` are always included.

## Logo Lookup

Two options for company logos:

**Option 1: canonical logo search** (uses Logo.dev search when configured and a bounded domain fallback otherwise):
```bash
pnpm action search-logos --q "Acme"
```

Use a returned `logoUrl` directly. Do not call a second logo-provider action for
each result.

**Option 2: Google Image Search** (fallback):
```bash
pnpm action search-images --q "Acme logo transparent" --count 5
```

## Important Rules

- Always include style references for visual consistency
- Use `.fmd-img-placeholder` divs in slides before real images are generated
- Use one canonical provider action per conceptual search; do not loop legacy
  provider scripts or manually guess provider URLs
- After inserting an image, update the deck via the API
