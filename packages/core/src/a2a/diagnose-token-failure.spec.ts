import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { diagnoseA2ATokenFailure } from "./server.js";

const SECRET = "deploy-secret-for-diagnosis";
const AUDIENCE = "https://workspace.example.test/dispatch";

async function sign(
  options: {
    secret?: string;
    audience?: string;
    expiresIn?: string | number;
  } = {},
) {
  const jwt = new jose.SignJWT({
    sub: "member@example.com",
    org_domain: "example.test",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("https://workspace.example.test")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1m");
  jwt.setAudience(options.audience ?? AUDIENCE);
  return jwt.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

describe("diagnoseA2ATokenFailure", () => {
  beforeEach(() => {
    vi.stubEnv("A2A_SECRET", SECRET);
    vi.stubEnv("APP_URL", "https://workspace.example.test");
    vi.stubEnv("APP_BASE_PATH", "/dispatch");
    vi.stubEnv("URL", "");
    vi.stubEnv("DEPLOY_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says a token that checks out against the deploy secret failed at the organization", async () => {
    await expect(diagnoseA2ATokenFailure(await sign())).resolves.toBe(
      "org-binding",
    );
  });

  it("says a token signed with another secret failed on its signature", async () => {
    await expect(
      diagnoseA2ATokenFailure(await sign({ secret: "some-other-secret" })),
    ).resolves.toBe("signature");
  });

  it("says a token minted for another address failed on its audience", async () => {
    await expect(
      diagnoseA2ATokenFailure(
        await sign({ audience: "https://workspace.example.test" }),
      ),
    ).resolves.toBe("audience");
  });

  it("says an expired token expired", async () => {
    await expect(
      diagnoseA2ATokenFailure(
        await sign({ expiresIn: Math.floor(Date.now() / 1000) - 120 }),
      ),
    ).resolves.toBe("expired");
  });

  it("reports a receiver with no deploy secret", async () => {
    const token = await sign();
    vi.stubEnv("A2A_SECRET", "");

    await expect(diagnoseA2ATokenFailure(token)).resolves.toBe(
      "secret-missing",
    );
  });

  it("reports a receiver that cannot work out its own audience", async () => {
    const token = await sign();
    vi.stubEnv("APP_URL", "");

    await expect(diagnoseA2ATokenFailure(token)).resolves.toBe(
      "audience-unresolvable",
    );
  });

  it("reports a value that is not a token", async () => {
    await expect(diagnoseA2ATokenFailure("not-a-jwt")).resolves.toBe(
      "malformed",
    );
  });
});
