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
scripts/           # Agent-callable scripts
shared/            # TypeScript types
```

## Key Patterns

- **Data flow**: UI -> React Query -> API route -> Jira API
- **Auth**: OAuth tokens in SQL via `@agent-native/core/oauth-tokens`
- **State sync**: SSE from backend, React Query invalidation
- **ADF**: Jira uses Atlassian Document Format for rich text. We convert ADF <-> HTML/Markdown.

## Running Scripts

```bash
pnpm script list-issues --compact
pnpm script get-issue --key=PROJ-123
pnpm script create-issue --project=PROJ --summary="Fix bug"
```
