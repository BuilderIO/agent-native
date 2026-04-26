---
name: slide-images
description: Image generation workflow -- generate-image, image-search, logo-lookup scripts. Style reference patterns.
---

# Slide Images

Images for slides are generated or sourced via three scripts. The agent delegates image generation through the agent chat for conversational follow-up.

## Scripts

| Script | Purpose | Example |
|--------|---------|---------|
| `generate-image` | Generate images (Gemini/OpenAI/auto) | `pnpm action generate-image --prompt "hero image" --model auto --count 3` |
| `image-search` | Search Google Images via Custom Search API | `pnpm action image-search --query "Acme logo transparent" --count 5` |
| `logo-lookup` | Get company logo URL via Logo.dev API | `pnpm action logo-lookup --domain acme.com` |
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

**Option 1: Logo.dev API** (best quality, requires `LOGO_DEV_TOKEN`):
```bash
pnpm action logo-lookup --domain acme.com
```

**Option 2: Google Image Search** (fallback):
```bash
pnpm action image-search --query "Acme logo transparent" --count 5
```

## Important Rules

- Always include style references for visual consistency
- Use `.fmd-img-placeholder` divs in slides before real images are generated
- Never use web_search or manual URL guessing for images
- After inserting an image, update the deck via the API
