# Developing {{APP_NAME}}

Install dependencies, then run the hello action:

```bash
pnpm install
pnpm action hello --name Builder
```

Then run the production app-agent loop against this folder:

```bash
pnpm agent "Call hello for Builder"
```

Useful checks:

```bash
pnpm typecheck
```

This scaffold intentionally has no `app/` directory, React Router config, Vite config, or dev server. Add those only when you are ready for a UI surface; the Chat template is the UI-first scaffold.
