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
    const compose = readFixture("docker-compose.yml");

    expect(dockerfile).toContain("COPY package.json pnpm-lock.yaml ./");
    expect(dockerfile).toContain("RUN pnpm build");
    expect(dockerfile).toContain('CMD ["node", ".output/server/index.mjs"]');
    expect(compose).toContain(
      "DATABASE_URL: postgres://agent_native@postgres:5432/agent_native",
    );
    expect(compose).toContain("image: postgres:18");
    expect(compose).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(compose).not.toContain("POSTGRES_PASSWORD:");
    expect(compose).toContain("condition: service_healthy");
    expect(compose).toContain("postgres-data:/var/lib/postgresql");
    expect(readFixture("README.md")).toContain("docker compose up --build");
    expect(readFixture("env.example")).toContain("ANTHROPIC_API_KEY=");
  });
});
