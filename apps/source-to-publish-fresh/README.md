# Source to Publish

Source to Publish turns a pasted transcript, document, or article into a useful
publishing draft. It keeps the source and output shape visible, then opens the
right AgentSidebar for a bounded refinement pass.

Open [http://localhost:5173/source-to-publish](http://localhost:5173/source-to-publish).

The full-page chat remains available at `/` and `/chat/*`.

## Workflow

- Paste local source text or load the sample fixture.
- Choose Blog post, Decision brief, Social posts, or X thread.
- Draft locally, review the stacked result, copy it, or refine it with the
  AgentSidebar.

Imports, persistence, publishing destinations, and live model configuration are
not wired yet.

## Develop locally

Run locally:

```bash
cp .env.example .env
# Set AUTH_DISABLED=1 in .env for an account-free loopback preview.
pnpm install
pnpm dev
```

AI/provider setup still uses the shared Connect Builder / BYOK onboarding flow.
