---
"slides": patch
---

Fix file import to append slides instead of replacing the existing deck; add a Builder.io-managed image generation fallback (with Gemini/OpenAI provider fallback and model-aware aspect ratio mapping) so image generation works without a separate API key; fix the "Generate Image" popup getting stuck loading; render generated image variations as inline previews instead of plain links; and add support for dragging a generated image from the agent chat panel onto the slide canvas.
