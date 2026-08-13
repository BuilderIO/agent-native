import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILDER_CONNECT_AUDIENCE,
  BUILDER_CONNECT_ISSUER,
  BUILDER_CONNECT_SCOPE,
  BuilderConnectTokenError,
  BuilderPartnerNotConfiguredError,
  __resetBuilderConnectReplayGuardForTests,
  isBuilderPartnerConfigured,
  resolveBuilderPartnerSecrets,
  verifyBuilderConnectToken,
} from "./builder-connect-token.js";

const SECRET = "test-partner-secret-that-is-long-enough-32";
const NEXT_SECRET = "rotation-partner-secret-also-long-enough-1";

async function mint(
  overrides: Record<string, unknown> = {},
  options: {
    secret?: string;
    issuer?: string;
    audience?: string;
    expiresIn?: string | null;
    issuedAt?: number;
    jti?: string | null;
  } = {},
): Promise<string> {
  const jwt: SignJWT = new SignJWT({
    builderOrgId: "org-1",
    projectId: "proj-1",
    branchName: "feature/x",
    scope: BUILDER_CONNECT_SCOPE,
    ...overrides,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(options.issuer ?? BUILDER_CONNECT_ISSUER)
    .setAudience(options.audience ?? BUILDER_CONNECT_AUDIENCE)
    .setIssuedAt(options.issuedAt);
  if (options.expiresIn !== null) {
    jwt.setExpirationTime(options.expiresIn ?? "60s");
  }
  if (options.jti !== null) {
    jwt.setJti(options.jti ?? `jti-${Math.random().toString(36).slice(2)}`);
  }
  return jwt.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

describe("resolveBuilderPartnerSecrets", () => {
  beforeEach(() => {
    delete process.env.BUILDER_DESIGN_PARTNER_SECRET;
    delete process.env.BUILDER_DESIGN_PARTNER_SECRET_NEXT;
  });

  it("returns nothing when unset", () => {
    expect(resolveBuilderPartnerSecrets()).toEqual([]);
    expect(isBuilderPartnerConfigured()).toBe(false);
  });

  it("returns both sides of a rotation, primary first", () => {
    process.env.BUILDER_DESIGN_PARTNER_SECRET = SECRET;
    process.env.BUILDER_DESIGN_PARTNER_SECRET_NEXT = NEXT_SECRET;
    expect(resolveBuilderPartnerSecrets()).toEqual([SECRET, NEXT_SECRET]);
  });

  it("deduplicates when both env vars hold the same value", () => {
    process.env.BUILDER_DESIGN_PARTNER_SECRET = SECRET;
    process.env.BUILDER_DESIGN_PARTNER_SECRET_NEXT = SECRET;
    expect(resolveBuilderPartnerSecrets()).toEqual([SECRET]);
  });

  it("ignores a secret too short to be real, and whitespace", () => {
    process.env.BUILDER_DESIGN_PARTNER_SECRET = "short";
    expect(resolveBuilderPartnerSecrets()).toEqual([]);
    process.env.BUILDER_DESIGN_PARTNER_SECRET = "      ";
    expect(resolveBuilderPartnerSecrets()).toEqual([]);
  });
});

describe("verifyBuilderConnectToken", () => {
  beforeEach(() => {
    process.env.BUILDER_DESIGN_PARTNER_SECRET = SECRET;
    delete process.env.BUILDER_DESIGN_PARTNER_SECRET_NEXT;
    __resetBuilderConnectReplayGuardForTests();
  });

  afterEach(() => {
    delete process.env.BUILDER_DESIGN_PARTNER_SECRET;
    delete process.env.BUILDER_DESIGN_PARTNER_SECRET_NEXT;
  });

  it("accepts a well-formed token", async () => {
    await expect(
      verifyBuilderConnectToken(await mint()),
    ).resolves.toMatchObject({
      builderOrgId: "org-1",
      projectId: "proj-1",
      branchName: "feature/x",
    });
  });

  it("carries no user identity — the token names a branch, not a person", async () => {
    const claims = await verifyBuilderConnectToken(
      await mint({ email: "user@example.com" }),
    );
    expect(claims).not.toHaveProperty("email");
  });

  it("accepts a token signed with the rotation secret", async () => {
    process.env.BUILDER_DESIGN_PARTNER_SECRET_NEXT = NEXT_SECRET;
    await expect(
      verifyBuilderConnectToken(await mint({}, { secret: NEXT_SECRET })),
    ).resolves.toBeTruthy();
  });

  it("reports a missing deployment secret distinctly from a bad token", async () => {
    delete process.env.BUILDER_DESIGN_PARTNER_SECRET;
    await expect(verifyBuilderConnectToken("anything")).rejects.toBeInstanceOf(
      BuilderPartnerNotConfiguredError,
    );
  });

  it("rejects a wrong secret, audience, issuer, or expiry", async () => {
    for (const token of [
      await mint({}, { secret: "a-completely-different-secret-32c" }),
      await mint({}, { audience: "evil.example.com" }),
      await mint({}, { issuer: "evil.example.com" }),
      await mint({}, { expiresIn: "-10s" }),
    ]) {
      await expect(verifyBuilderConnectToken(token)).rejects.toBeInstanceOf(
        BuilderConnectTokenError,
      );
    }
  });

  it("rejects a token that never expires", async () => {
    await expect(
      verifyBuilderConnectToken(await mint({}, { expiresIn: null })),
    ).rejects.toBeInstanceOf(BuilderConnectTokenError);
  });

  it("rejects a token minted far in the past, whatever its expiry says", async () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      verifyBuilderConnectToken(
        await mint({}, { issuedAt: anHourAgo, expiresIn: "24h" }),
      ),
    ).rejects.toBeInstanceOf(BuilderConnectTokenError);
  });

  it("rejects an unsigned (alg=none) token", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        builderOrgId: "org-1",
        projectId: "proj-1",
        branchName: "feature/x",
        scope: BUILDER_CONNECT_SCOPE,
        iss: BUILDER_CONNECT_ISSUER,
        aud: BUILDER_CONNECT_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    await expect(
      verifyBuilderConnectToken(`${header}.${body}.`),
    ).rejects.toBeInstanceOf(BuilderConnectTokenError);
  });

  it("rejects a wrong or absent scope", async () => {
    await expect(
      verifyBuilderConnectToken(await mint({ scope: "something-else" })),
    ).rejects.toThrow(/scope must be/);
    await expect(
      verifyBuilderConnectToken(await mint({ scope: undefined })),
    ).rejects.toThrow(/scope must be/);
  });

  it("rejects a token missing or blanking any required claim", async () => {
    for (const claim of ["builderOrgId", "projectId", "branchName"]) {
      await expect(
        verifyBuilderConnectToken(await mint({ [claim]: undefined })),
        claim,
      ).rejects.toThrow(new RegExp(`missing "${claim}" claim`));
      await expect(
        verifyBuilderConnectToken(await mint({ [claim]: "   " })),
        claim,
      ).rejects.toThrow(new RegExp(`missing "${claim}" claim`));
    }
  });

  it("rejects absent, blank, and non-string tokens", async () => {
    for (const value of [undefined, null, "", "   ", 42, {}]) {
      await expect(
        verifyBuilderConnectToken(value),
        String(value),
      ).rejects.toThrow(/no token supplied/);
    }
  });

  it("rejects a replayed jti but not a distinct one", async () => {
    const token = await mint({}, { jti: "replay-me" });
    await expect(verifyBuilderConnectToken(token)).resolves.toBeTruthy();
    await expect(verifyBuilderConnectToken(token)).rejects.toThrow(
      /already been used/,
    );
    await expect(
      verifyBuilderConnectToken(await mint({}, { jti: "other" })),
    ).resolves.toBeTruthy();
  });

  it("lets a jti be reused once its retention window has passed", async () => {
    const token = await mint({}, { jti: "expiring" });
    const start = Date.now();
    await expect(
      verifyBuilderConnectToken(token, { now: () => start }),
    ).resolves.toBeTruthy();
    await expect(
      verifyBuilderConnectToken(token, { now: () => start + 200_000 }),
    ).resolves.toBeTruthy();
  });

  it("rejects a token with no jti, which would stay replayable for its TTL", async () => {
    await expect(
      verifyBuilderConnectToken(await mint({}, { jti: null })),
    ).rejects.toThrow(/jti/);
  });
});
