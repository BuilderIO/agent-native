import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveCredentials: vi.fn(),
  resolveMetadataByDomain: vi.fn(),
  resolveMetadataById: vi.fn(),
}));

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  resolveA2AOrganizationCredentialsByDomain: mocks.resolveCredentials,
  resolveA2AOrganizationMetadataByDomain: mocks.resolveMetadataByDomain,
  resolveA2AOrganizationMetadataById: mocks.resolveMetadataById,
}));

import { diagnoseA2ATokenFailure } from "./server.js";

const SECRET = "deploy-secret-for-diagnosis";
const ORG_SECRET = "organization-secret-for-diagnosis";
const AUDIENCE = "https://workspace.example.test/dispatch";
const ORG = { orgId: "org-1", orgDomain: "example.test" };

async function sign(
  options: {
    secret?: string;
    audience?: string;
    expiresIn?: string | number;
    claims?: Record<string, unknown>;
  } = {},
) {
  const jwt = new jose.SignJWT(
    options.claims ?? {
      sub: "member@example.com",
      org_domain: "example.test",
    },
  )
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
    mocks.resolveCredentials.mockResolvedValue(null);
    mocks.resolveMetadataByDomain.mockResolvedValue(null);
    mocks.resolveMetadataById.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.resolveCredentials.mockReset();
    mocks.resolveMetadataByDomain.mockReset();
    mocks.resolveMetadataById.mockReset();
  });

  describe("a token the deploy secret verifies", () => {
    it("says the organization could not be bound when the domain is unknown here", async () => {
      await expect(diagnoseA2ATokenFailure(await sign())).resolves.toBe(
        "org-binding",
      );
    });

    it("does not blame the organization when it binds fine", async () => {
      mocks.resolveMetadataByDomain.mockResolvedValue(ORG);

      await expect(diagnoseA2ATokenFailure(await sign())).resolves.toBe(
        "undetermined",
      );
    });

    it("names a token with no subject instead of blaming the organization", async () => {
      const token = await sign({ claims: { org_domain: "example.test" } });

      await expect(diagnoseA2ATokenFailure(token)).resolves.toBe(
        "missing-subject",
      );
    });

    it("names a connect credential, which the A2A verifier never accepts", async () => {
      const token = await sign({
        claims: {
          sub: "member@example.com",
          org_domain: "example.test",
          scope: "mcp-connect",
        },
      });

      await expect(diagnoseA2ATokenFailure(token)).resolves.toBe(
        "mcp-credential",
      );
    });

    it("reports an unreadable organization registry as its own cause", async () => {
      mocks.resolveMetadataByDomain.mockRejectedValue(new Error("db down"));

      await expect(diagnoseA2ATokenFailure(await sign())).resolves.toBe(
        "org-lookup-failed",
      );
    });
  });

  describe("a token the deploy secret does not verify", () => {
    it("says a token signed with an unknown secret failed on its signature", async () => {
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
  });

  describe("a token signed with the organization's own secret", () => {
    beforeEach(() => {
      mocks.resolveCredentials.mockResolvedValue({
        ...ORG,
        secret: ORG_SECRET,
      });
    });

    it("blames the audience, not the signature, when the audience is wrong", async () => {
      const token = await sign({
        secret: ORG_SECRET,
        audience: "https://workspace.example.test",
      });

      await expect(diagnoseA2ATokenFailure(token)).resolves.toBe("audience");
    });

    it("still checks the organization secret when the deploy secret is unset", async () => {
      vi.stubEnv("A2A_SECRET", "");
      const token = await sign({
        secret: ORG_SECRET,
        audience: "https://workspace.example.test",
      });

      await expect(diagnoseA2ATokenFailure(token)).resolves.toBe("audience");
    });

    it("reports the missing deploy secret only when no organization credential explains the refusal", async () => {
      vi.stubEnv("A2A_SECRET", "");
      mocks.resolveCredentials.mockResolvedValue(null);

      await expect(
        diagnoseA2ATokenFailure(await sign({ secret: ORG_SECRET })),
      ).resolves.toBe("secret-missing");
    });

    it("blames the organization when the secret and audience check out but the domain does not bind", async () => {
      mocks.resolveCredentials.mockResolvedValue({
        orgId: "org-1",
        orgDomain: "other.test",
        secret: ORG_SECRET,
      });

      await expect(
        diagnoseA2ATokenFailure(await sign({ secret: ORG_SECRET })),
      ).resolves.toBe("org-binding");
    });

    it("still calls a secret nobody holds a signature failure", async () => {
      await expect(
        diagnoseA2ATokenFailure(await sign({ secret: "nobody-has-this" })),
      ).resolves.toBe("signature");
    });

    it("reports an unreadable organization registry as its own cause", async () => {
      mocks.resolveCredentials.mockRejectedValue(new Error("db down"));

      await expect(
        diagnoseA2ATokenFailure(await sign({ secret: ORG_SECRET })),
      ).resolves.toBe("org-lookup-failed");
    });
  });

  describe("inputs it cannot check", () => {
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
});
