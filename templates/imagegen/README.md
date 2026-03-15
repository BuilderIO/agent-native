# ImageGen — AI-Native Brand Asset Manager

Manage your brand assets and generate on-brand images with AI. Upload your brand's logos, colors, and style reference images. The agent analyzes your visual style and generates new images that stay on-brand.

## Features

- **Brand Library** — Upload logos, define colors and fonts, manage style reference images
- **Style Profiling** — AI analyzes your reference images to extract color palettes, textures, mood, and composition patterns
- **On-Brand Generation** — Generate images from text prompts that match your brand's visual style
- **Batch Variations** — Generate 1-8 style-consistent variations per prompt
- **Gallery** — Browse, download, and manage all generated images

## Setup

1. Get a [Gemini API key](https://aistudio.google.com/apikey)
2. Create `.env` with `GEMINI_API_KEY=your-key`
3. `pnpm install && pnpm dev`

## How It Works

1. Upload style reference images that define your brand's visual identity
2. The agent analyzes them and builds a style profile
3. Enter a prompt and generate on-brand image variations
4. Download and use your generated assets
