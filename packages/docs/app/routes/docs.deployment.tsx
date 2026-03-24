import DocsLayout from "../components/DocsLayout";
import CodeBlock from "../components/CodeBlock";

const TOC = [
  { id: "how-it-works", label: "How It Works" },
  { id: "setting-the-preset", label: "Setting the Preset" },
  { id: "nodejs", label: "Node.js (Default)" },
  { id: "vercel", label: "Vercel" },
  { id: "netlify", label: "Netlify" },
  { id: "cloudflare-pages", label: "Cloudflare Pages" },
  { id: "aws-lambda", label: "AWS Lambda" },
  { id: "deno-deploy", label: "Deno Deploy" },
  { id: "environment-variables", label: "Environment Variables" },
  { id: "file-sync", label: "File Sync in Production" },
];

export default function DeploymentDocs() {
  return (
    <DocsLayout toc={TOC}>
      <h1 className="mb-2 text-4xl font-semibold tracking-tight">Deployment</h1>
      <p className="mb-4 text-base text-[var(--fg-secondary)]">
        Agent-native apps use{" "}
        <a href="https://nitro.build" target="_blank" rel="noopener noreferrer">
          Nitro
        </a>{" "}
        under the hood, which means you can deploy to any platform with zero
        config changes — just set a preset.
      </p>

      <h2 id="how-it-works">How It Works</h2>
      <p>
        When you run <code>agent-native build</code>, Nitro builds both the
        client SPA and the server API into <code>.output/</code>:
      </p>
      <CodeBlock
        code={`.output/
  public/          # Built SPA (static assets)
  server/
    index.mjs      # Server entry point
    chunks/         # Server code chunks`}
        lang="text"
      />
      <p>
        The output is self-contained — copy <code>.output/</code> to any
        environment and run it.
      </p>

      <h2 id="setting-the-preset">Setting the Preset</h2>
      <p>
        By default, Nitro builds for Node.js. To target a different platform,
        set the preset in your <code>vite.config.ts</code>:
      </p>
      <CodeBlock
        code={`import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  nitro: {
    preset: "vercel",
  },
});`}
      />
      <p>
        Or use the <code>NITRO_PRESET</code> environment variable at build time:
      </p>
      <CodeBlock code="NITRO_PRESET=netlify agent-native build" lang="bash" />

      <h2 id="nodejs">Node.js (Default)</h2>
      <p>The default preset. Build and run:</p>
      <CodeBlock
        code={`agent-native build
node .output/server/index.mjs`}
        lang="bash"
      />
      <p>
        Set <code>PORT</code> to configure the listen port (default:{" "}
        <code>3000</code>).
      </p>

      <h3>Docker</h3>
      <CodeBlock
        code={`FROM node:20-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/.output .output
COPY --from=build /app/data data
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]`}
        lang="dockerfile"
      />

      <h2 id="vercel">Vercel</h2>
      <CodeBlock
        code={`// vite.config.ts
export default defineConfig({
  nitro: { preset: "vercel" },
});`}
      />
      <p>Deploy via the Vercel CLI or git push:</p>
      <CodeBlock code="vercel deploy" lang="bash" />

      <h2 id="netlify">Netlify</h2>
      <CodeBlock
        code={`// vite.config.ts
export default defineConfig({
  nitro: { preset: "netlify" },
});`}
      />
      <p>Deploy via the Netlify CLI or git push:</p>
      <CodeBlock code="netlify deploy --prod" lang="bash" />

      <h2 id="cloudflare-pages">Cloudflare Pages</h2>
      <CodeBlock
        code={`// vite.config.ts
export default defineConfig({
  nitro: { preset: "cloudflare_pages" },
});`}
      />

      <h2 id="aws-lambda">AWS Lambda</h2>
      <CodeBlock
        code={`// vite.config.ts
export default defineConfig({
  nitro: { preset: "aws_lambda" },
});`}
      />

      <h2 id="deno-deploy">Deno Deploy</h2>
      <CodeBlock
        code={`// vite.config.ts
export default defineConfig({
  nitro: { preset: "deno_deploy" },
});`}
      />

      <h2 id="environment-variables">Environment Variables</h2>
      <table>
        <thead>
          <tr>
            <th>Variable</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["PORT", "Server port (Node.js only)"],
            ["NITRO_PRESET", "Override build preset at build time"],
            ["ACCESS_TOKEN", "Enable auth gating for production mode"],
            ["ANTHROPIC_API_KEY", "API key for embedded production agent"],
            ["FILE_SYNC_ENABLED", "Enable file sync for multi-instance"],
          ].map(([name, desc]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="file-sync">File Sync in Production</h2>
      <p>
        By default, agent-native apps store state in local files. For
        multi-instance deployments (e.g., serverless or load-balanced), enable
        file sync to keep instances in sync:
      </p>
      <CodeBlock code="FILE_SYNC_ENABLED=true" lang="bash" />
      <p>
        See <a href="/docs/file-sync">File Sync</a> for adapter configuration
        (Firestore, Supabase, Convex).
      </p>
    </DocsLayout>
  );
}
