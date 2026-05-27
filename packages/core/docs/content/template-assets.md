---
title: "Assets"
description: "An agent-native digital asset manager and cross-agent generation service for brand-consistent media."
---

# Assets

Assets is an agent-native workspace for creating and managing brand-consistent media. It organizes uploads and generated results into libraries and folders, lets teams collect examples for blog heroes, diagrams, landing pages, product shots, videos, and logos, then routes generation through the agent chat so every asset can be reviewed and refined.

Use it when your team needs reusable visual direction and searchable source assets instead of one-off generic media prompts.

![Assets library for brand media and generated output](https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F769092170a14474f998cbca47384f891?format=webp&width=1200)

## Start Here

1. **Create a library.** Add the brand, campaign, product, or content stream you
   want to manage.
2. **Upload references.** Add approved logos, product shots, style examples, or
   existing videos so the agent has concrete material to work from.
3. **Generate from chat or a library.** Ask for a hero image, diagram, product
   shot, or video variant. Assets stores the prompt, references, model, status,
   and lineage for review.
4. **Use the asset elsewhere.** Copy the export, embed the picker in another
   app, or let another agent call Assets over A2A.

## Useful Prompts

- "Generate three blog hero options using the Acme product screenshots as references."
- "Create a square social image in the launch-campaign style."
- "Find all approved assets for the onboarding redesign."
- "Turn this uploaded diagram into a cleaner product explainer image."
- "Create a video storyboard and save the best frame set to this library."

## What You Can Do With It

- **Create asset libraries.** Group reference images, videos, canonical logos, style notes, palettes, folders, and generated output by brand, campaign, product, or category.
- **Generate through chat.** The home composer and library Generate controls send the prompt to the agent with `sendToAgentChat()`, so users can inspect variants, give feedback, and iterate.
- **Generate images and videos.** Builder-managed image generation is available when enabled, and Gemini powers video generation plus the manual image fallback.
- **Upload and describe references.** Add images or videos from the library UI or prompt composer attachment button, then search by title, description, alt text, prompt, model, media type, status, role, folder, or collection.
- **Keep a generation audit log.** Every run records prompts, model, aspect ratio, references, source asset, lineage, generated assets, status, errors, and timestamps for later design review.
- **Preserve logo accuracy.** The agent can generate a placeholder area and the server composites the uploaded canonical logo onto the final image instead of relying on the image model to redraw it.
- **Embed as a picker.** Other apps can iframe `/picker` and listen for the `chooseAsset` event from `@agent-native/embedding`, turning Assets into an asset picker/generator for blog editors, site builders, slide decks, and custom apps. The picker also emits the legacy `chooseImage` alias for existing image-only hosts.
- **Install as an app-backed skill.** The `agent-native.app-skill.json` manifest exports an Assets skill plus MCP connector metadata so marketplaces can install the app, its instructions, and its picker together.
- **Serve other agents.** Slides, Design, Content, Mail, and Dispatch can call Assets through A2A to list libraries, generate batches, create videos, refine an asset, fetch exports, and render inline previews where embedding is allowed.

## Why It's Interesting

Most AI media tools treat brand consistency as a prompt-writing problem. Assets treats it as application state: references, folders, collections, style briefs, run history, descriptions, and saved assets live in SQL, while binary media lives in object storage or the local file-upload fallback during development.

Because generation and library management are actions and chat workflows, the UI and the agent share the same operations. A user can start from the big prompt box, a library detail page, another app's chat, or an A2A request from Slides, and the same audit and lineage model is preserved. Once enabled, the provider path prefers Builder-managed image generation so teams do not need to paste model-provider keys into every app.

## For Developers

The rest of this doc is for anyone forking the Assets template or extending it.

### Scaffolding

```bash
pnpm dlx @agent-native/core create my-assets --template assets --standalone
```

### Customize It

Assets is a complete, cloneable template. Some practical extension ideas:

- "Add a product catalog connector so product reference shots can be selected by SKU."
- "Add a strict approval queue before generated assets are marked usable for marketing."
- "Add a brand review dashboard that filters failed or low-rated generations by model."
- "Create a workspace-wide default asset library and route Slides image generation through it."
- "Add a new provider behind the image generation interface after checking the latest provider docs."

The agent edits routes, components, actions, skills, and SQL-backed models as needed. See [Templates](/docs/cloneable-saas) for the full clone, customize, deploy flow, and [A2A Protocol](/docs/a2a-protocol) for cross-app generation.

### Embed The Picker

Use the picker route when a human is choosing or generating an asset inside
another product. Image is the default media type; pass `mediaType=video` when
you want video browsing/selection:

```tsx
import { EmbeddedApp } from "@agent-native/embedding";

<EmbeddedApp
  url="https://assets.agent-native.com/picker?mediaType=image"
  onMessage={(name, payload) => {
    if (name === "chooseAsset") {
      insertAsset((payload as { url: string }).url);
    }
  }}
/>;
```

External MCP hosts should call `open-asset-picker` instead of constructing this
iframe by hand. The action returns a browser fallback link and MCP App metadata
for inline hosts. When a user selects an asset, the picker emits `chooseAsset`,
the legacy `chooseImage` alias for image assets, and updates MCP App model
context where the host supports it.

Use A2A when another agent needs to create, search, or export assets without a
human picker UI.

### Developer: Distribute The App Skill

The Assets app skill has app id `assets` and hosted MCP URL
`https://assets.agent-native.com/_agent-native/mcp`.

```bash
# Easiest hosted install: exported skill instructions plus MCP connector.
npx @agent-native/core@latest skills add assets

# Hosted install: URL-only MCP connector, no shared secrets in skill files.
agent-native app-skill ensure --manifest templates/assets/agent-native.app-skill.json

# Local editable launch.
agent-native app-skill launch --manifest templates/assets/agent-native.app-skill.json --local --into ./assets-local

# Marketplace package, including Claude Code marketplace and Vercel Labs skills adapters.
agent-native app-skill pack --manifest templates/assets/agent-native.app-skill.json --out ./dist/assets-skill

# Install the exported Assets skill with the open skills CLI.
npx skills add ./dist/assets-skill --skill assets -a codex -y

# Install from the generated Claude Code marketplace adapter.
claude plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace
claude plugin install agent-native-assets@agent-native-apps
```

The exported skill teaches agents to use the picker for human-in-the-loop
selection, direct actions for unattended image/video generation, and browser
links when inline MCP Apps are unavailable.

The Claude marketplace adapter contains a `.claude-plugin/marketplace.json`
catalog and an `agent-native-assets` plugin with `skills/assets/SKILL.md` plus
the hosted `.mcp.json`. In interactive Claude Code, the same flow is available
as `/plugin marketplace add ./dist/assets-skill/adapters/claude-marketplace`,
`/plugin install agent-native-assets@agent-native-apps`, `/reload-plugins`, and
`/mcp` for MCP authentication.

If you install from a raw marketplace bundle with `npx skills`, register the
hosted MCP connector so those instructions can call the live Assets app:

```bash
npx @agent-native/core@latest app-skill ensure --manifest ./dist/assets-skill/agent-native.app-skill.json --yes
```

## What's Next

- [**Templates**](/docs/cloneable-saas) — the clone-and-own model
- [**Embedding SDK**](/docs/embedding-sdk) — iframe picker and sidecar patterns
- [**A2A Protocol**](/docs/a2a-protocol) — how other apps call Assets
- [**File Uploads**](/docs/file-uploads) — storage and authenticated asset serving
- [**Sharing & Privacy**](/docs/sharing) — library-level access control
