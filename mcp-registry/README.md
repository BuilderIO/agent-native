# Official MCP Registry

The repository generates one current `server.json` per public Agent-Native app
from `packages/shared-app-config/templates.ts` and
`scripts/netlify-production-sites.json`.

```sh
pnpm guard:mcp-registry
pnpm mcp-registry:write -- .tmp/mcp-registry
```

The generated files use the `io.github.builderio/agent-native-*` namespace and
the deployed `/mcp` URL for each app. Chat uses its production `starter` alias.
Hidden internal templates are intentionally not published.

To publish, dispatch **Publish MCP Registry servers** from `main` and choose a
public app slug or `all`. The workflow validates every file with the pinned
`mcp-publisher` v1.8.1, verifies its release checksum, and authenticates with
GitHub Actions OIDC only when there are new records. Reruns skip exact
name/version records already present in the Official Registry.
Registry versions live in `scripts/mcp-registry.ts`; bump an app's version
before publishing changed metadata because registry entries are immutable.
