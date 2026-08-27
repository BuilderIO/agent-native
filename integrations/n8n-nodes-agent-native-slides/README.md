# Agent-Native Slides n8n node

Use Agent-Native Slides decks and slide comments in n8n. This community node supports declarative routing only and is usable as an AI tool.

## Install

Install `n8n-nodes-agent-native-slides` from **Settings → Community Nodes** in n8n, or install it in a self-hosted n8n instance:

```bash
npm install n8n-nodes-agent-native-slides
```

## Credentials

Create an **Agent-Native Slides API** credential in n8n. Set the Base URL to your self-hosted Slides URL, or leave the default `https://slides.agent-native.com`. In the Agent-Native Slides UI, open **Settings → API Tokens**, create an API token, and paste it into **API Token**. The CLI remains available when needed: `npx @agent-native/core connect <slides-url> [--service-token <name>]`.

The credential test calls `GET /_agent-native/actions/list-decks?light=true` and succeeds only on HTTP 200.

## Decks

The **Deck → Create** operation accepts repeatable slide fields (stable Slide ID, HTML content, layout, and speaker notes) and an optional **Raw Deck JSON** override. This node never generates deck or slide IDs. Raw JSON must be a full deck payload with a descriptive title and slides using existing IDs. Empty titles and opaque ID-like titles are rejected by Slides title validation.

Supplying an existing **Deck ID** to Create sends `PUT /_agent-native/actions/save-deck` with the full deck payload. Without it, the node calls `create-deck`. Get Many supports a limit and `updatedSince`; use **Return All** to request successive cursor pages.

Export PPTX and Export HTML return `downloadUrl`, `filename`, and `expiresAt`. `downloadUrl` is unauthenticated but expires in 10 minutes. Keep **Download File** enabled (the default) to fetch it immediately into n8n binary data; do not pass the short-lived URL to later workflow steps. `appUrl` is a human link and requires a signed-in user with access to the deck.

Sharing is intentionally not exposed yet. A share API is planned, alongside a v0.2 instant trigger/webhook integration. Slides already exposes a webhook subscription API; see `templates/slides/docs/webhooks.md` in this repository for its event catalog and delivery contract.

## Recipes

- Generate a recurring report deck, export it to PPTX, and attach the downloaded binary to a scheduled email.
- Duplicate a deck once per lead, personalize the copy in your workflow, and share its `appUrl` with a teammate who already has access.
- Get Many comments from a slide and post each comment to Slack for review.

## Brand assets

`icons/agent-native-slides.svg` and `icons/agent-native-slides.dark.svg` are copied from the official Slides template assets at `templates/slides/public/agent-native-logo-light.svg` and `templates/slides/public/agent-native-logo-dark.svg` in this repository. They are the official light and dark Agent-Native brand SVGs, not fabricated assets.
