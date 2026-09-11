import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const fixtureRoot = fileURLToPath(
  new URL("../public/examples/self-hosted-chat/", import.meta.url),
);

function readFixture(name: string) {
  return readFileSync(`${fixtureRoot}/${name}`, "utf8");
}

describe("self-hosted Chat fixture", () => {
  it("keeps the downloadable files aligned with the local quickstart", () => {
    const dockerfile = readFixture("Dockerfile");
    const dockerfileDownload = readFixture("Dockerfile.txt");
    const dockerignore = readFixture(".dockerignore");
    const compose = readFixture("docker-compose.yml");
    const netlifyConfig = readFileSync(
      new URL("../netlify.toml", import.meta.url),
      "utf8",
    );

    expect(dockerfileDownload).toBe(dockerfile);
    expect(netlifyConfig).toContain(
      'from = "/examples/self-hosted-chat/Dockerfile"\nto = "/examples/self-hosted-chat/Dockerfile.txt"\nstatus = 200',
    );
    expect(dockerfile).toContain("COPY package.json pnpm-lock.yaml ./");
    expect(dockerfile).toContain("RUN pnpm build");
    expect(dockerfile).toContain('CMD ["node", ".output/server/index.mjs"]');
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain(".output");
    expect(dockerignore).toContain("data");
    expect(dockerignore).toContain(".env");
    expect(compose).toContain(
      "DATABASE_URL: postgres://agent_native@postgres:5432/agent_native",
    );
    expect(compose).toContain('"127.0.0.1:3000:3000"');
    expect(compose).not.toContain("BETTER_AUTH_URL: http://localhost:3000");
    expect(compose).toContain("image: postgres:18");
    expect(compose).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(compose).not.toContain("POSTGRES_PASSWORD:");
    expect(compose).toContain("condition: service_healthy");
    expect(compose).toContain("postgres-data-v18:/var/lib/postgresql");
    expect(readFixture("README.md")).toContain(
      "create my-app --standalone --template chat",
    );
    expect(readFixture("README.md")).toContain(".dockerignore");
    expect(readFixture("README.md")).toContain("postgres-data-v18");
    expect(readFixture("README.md")).toContain("docker compose up --build");
    expect(readFixture("env.example")).toContain("ANTHROPIC_API_KEY=");
  });
});
