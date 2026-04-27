# Development Guide

## Setup

1. Install dependencies: `pnpm install` (from workspace root)
2. Create `.env` from `.env.example`:
   ```
   ATLASSIAN_CLIENT_ID=your_client_id
   ATLASSIAN_CLIENT_SECRET=your_secret
   ```
3. Start dev server: `pnpm dev`
4. Follow the onboarding wizard in the UI to connect your Atlassian account

## Atlassian OAuth Setup

1. Go to https://developer.atlassian.com/console/myapps/
2. Create a new "OAuth 2.0 (3LO)" integration
3. Under Permissions, add: `read:jira-work`, `write:jira-work`, `read:jira-user`
4. Under Authorization > OAuth 2.0 (3LO), set callback URL to: `http://localhost:8080/api/atlassian/callback`
5. Copy Client ID and Secret to your `.env` file
6. Restart the dev server

## Project Structure

```
app/               # React frontend
  routes/          # File-based routes
  pages/           # Page components
  components/      # UI components
  hooks/           # React Query hooks
  lib/             # Utilities
server/            # Nitro API backend
  routes/api/      # REST endpoints
  handlers/        # Business logic
  lib/             # Jira API client, auth, ADF converter
  plugins/         # Server plugins
actions/           # Agent-callable scripts
shared/            # TypeScript types
```

## Key Patterns

- **Data flow**: UI -> React Query -> API route -> Jira API
- **Auth**: OAuth tokens in SQL via `@agent-native/core/oauth-tokens`
- **State sync**: SSE from backend, React Query invalidation
- **ADF**: Jira uses Atlassian Document Format for rich text. We convert ADF <-> HTML/Markdown.

## Running Scripts

```bash
pnpm action list-issues --compact
pnpm action get-issue --key=PROJ-123
pnpm action create-issue --project=PROJ --summary="Fix bug"
```


## Tools (Framework Feature)

The framework provides **Tools** — mini sandboxed Alpine.js apps that run inside iframes. Tools let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under a "Tools" section.

- **Creating tools**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/tools`
- **API calls**: Tools use `toolFetch()` which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Tools inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `tools` skill in `.agents/skills/tools/SKILL.md` for full implementation details.
