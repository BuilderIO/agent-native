# Learnings

## Brandfetch API

### Two APIs: Logo API vs Brand API
- **Logo API (CDN)**: Uses `https://cdn.brandfetch.io/:domain` URLs with a `?c=CLIENT_ID` query param. The client ID is a separate key from the Brand API key.
- **Brand API**: Uses `https://api.brandfetch.io/v2/brands/:domain` with `Authorization: Bearer API_KEY` header. Returns full brand data including logo asset URLs.

### The key we have is a Brand API key
- The key stored in `BRANDFETCH_CLIENT_ID` env var (`oBi4Cty5...`) is actually a **Brand API key**, not a Logo API client ID.
- Using it as `?c=` on the CDN returns **403 Forbidden**.
- Use it as `Authorization: Bearer` header on the Brand API instead.

### How to get logo URLs
1. Call `GET https://api.brandfetch.io/v2/brands/:domain` with `Authorization: Bearer API_KEY`
2. Parse `response.logos` array
3. Each logo has `type` (logo, icon, symbol), `theme` (light, dark), and `formats` array
4. Filter for `type === 'logo'` and `theme === 'dark'` for white logos on dark backgrounds
5. Pick `format === 'svg'` first, fallback to `format === 'png'`
6. Use the `src` field from the chosen format — these are direct asset URLs like:
   `https://cdn.brandfetch.io/idNMs_nMA0/theme/dark/logo.svg?c=1bxin53im4siw5hzkq36yn260s2Y1YkCroE`

### Dark theme !== all white
- Brandfetch "dark" theme means "suitable for dark backgrounds" — logos may still use brand colors (red, blue, etc.)
- To force all-white logos, apply CSS `filter: brightness(0) invert(1)` on the `<img>` tag
- The `brightness(0)` makes all pixels black, `invert(1)` flips to white

### Logo API CDN URL format (if you have a Logo API client ID)
```
https://cdn.brandfetch.io/:domain?c=CLIENT_ID                    # default icon
https://cdn.brandfetch.io/:domain/theme/dark/logo?c=CLIENT_ID    # dark theme logo
https://cdn.brandfetch.io/:domain/w/400/h/400/theme/dark/fallback/lettermark/type/icon?c=CLIENT_ID  # full params
```

### CDN hotlinking requirements
- The CDN requires proper `Referer` headers — browser `<img>` tags work, but server-side `fetch()` without Referer returns HTML docs pages or 403.

## Tabler Icons
- Use inline SVG from Tabler Icons for slide icons
- Set `stroke` color to match the design (e.g., `#00E5FF` for cyan)
- Standard viewBox: `0 0 24 24`, stroke-width: `1.5`

## Deck Slide Content
- Slide content is stored as raw HTML strings in `data/decks/*.json`
- Rendered via `dangerouslySetInnerHTML` for `blank` layout slides — no sanitization
- Inline SVGs work in slide content
