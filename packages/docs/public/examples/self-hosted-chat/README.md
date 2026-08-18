# Self-hosted Chat example

This is a local-only Docker Compose fixture for a fresh Agent-Native Chat app.

1. Create an app and install dependencies:

   ```bash
   npx @agent-native/core@latest create my-app --standalone --template chat
   cd my-app
   pnpm install
   ```

2. Copy `Dockerfile`, `docker-compose.yml`, and `env.example` into the app root.
3. Copy `env.example` to `.env` and add `ANTHROPIC_API_KEY` if you want to use the embedded agent.
4. Start the local stack:

   ```bash
   docker compose up --build
   ```

Open http://localhost:3000. This example uses a development-only auth secret
and a local Postgres volume. Do not expose it to the public internet without
replacing the secrets, configuring HTTPS and OAuth callbacks, and following the
full [Deployment guide](https://www.agent-native.com/docs/deployment).
