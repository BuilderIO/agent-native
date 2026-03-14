# Image Generation

## How to Generate

Run: `pnpm script generate-images --prompt "description" --variations 4 --model gemini-3-pro-image-preview`

Optional: `--references file1.png,file2.png` to limit which reference images are used.

## Guidelines

- Include 3-5 reference images for best results (the script defaults to first 5)
- The style profile is automatically included when available
- Use Pro model for highest quality, Flash for speed
- For batch work, keep variations at 4; for exploration, try 8
- If generation fails, try the Flash model as fallback

## Models

- `gemini-3-pro-image-preview` — Best quality, slower, best text rendering
- `gemini-3.1-flash-image-preview` — Fast, good quality, best for iteration
- `gemini-2.5-flash-image` — Fallback model
