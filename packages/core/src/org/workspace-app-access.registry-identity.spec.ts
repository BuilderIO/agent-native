import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyA2AToken } from "../a2a/server.js";
import { resetAppConfigForTests } from "../app-config/index.js";
import { __resetProcessMemberOrgCacheForTests } from "./request-org-cache.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

import { isWorkspaceAppAccessAllowed } from "./workspace-app-access.js";

const DEPLOYMENT_SECRET = "workspace-deployment-secret";
const ORG_SECRET = "dispatch-org-secret";
const DIRECTORY_URL = "https://dispatch.example.test";

// One organizations table answers both sides: the app reads its domain and
// secret to sign, and Dispatch reads the same row to verify.
function scriptOrganization(orgSecret: string | null) {
  mocks.execute.mockImplementation(async (query: any) => {
    const sql: string = query?.sql ?? "";
    if (sql.includes("LOWER(allowed_domain)")) {
      return {
        rows: [
          {
            id: "org-1",
            allowed_domain: "example.test",
            a2a_secret: orgSecret,
            a2a_member_delegation_enabled: false,
          },
        ],
      };
    }
    if (sql.includes("SELECT allowed_domain")) {
      return { rows: [{ allowed_domain: "example.test" }] };
    }
    if (sql.includes("SELECT a2a_secret")) {
      return { rows: [{ a2a_secret: orgSecret }] };
    }
    return { rows: [] };
  });
}

// What Dispatch receives when an app asks it for the workspace registry, as
// the signed-in member `member@example.com` loads any page of that app.
async function registryBearerFromApp(): Promise<string> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify([{ id: "allowed-app" }]), {
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    isWorkspaceAppAccessAllowed("allowed-app", {
      email: "member@example.com",
      orgId: "org-1",
    }),
  ).resolves.toBe(true);
  const authorization = fetchMock.mock.calls[0]?.[1]?.headers
    ?.Authorization as string;
  return authorization.slice("Bearer ".length);
}

describe("workspace registry token, signed by an app and verified by Dispatch", () => {
  beforeEach(() => {
    __resetProcessMemberOrgCacheForTests();
    vi.stubEnv("A2A_SECRET", DEPLOYMENT_SECRET);
    vi.stubEnv("AGENT_NATIVE_ORG_DIRECTORY_URL", DIRECTORY_URL);
    // Dispatch derives the audience it expects from its own URL.
    vi.stubEnv("APP_URL", DIRECTORY_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
    __resetProcessMemberOrgCacheForTests();
    vi.unstubAllGlobals();
    mocks.execute.mockReset();
  });

  it("names the signed-in member when the organization has its own secret", async () => {
    scriptOrganization(ORG_SECRET);

    const identity = await verifyA2AToken(await registryBearerFromApp(), {});

    expect(identity.email).toBe("member@example.com");
  });

  it("names the signed-in member when the organization has no secret of its own", async () => {
    scriptOrganization(null);

    const identity = await verifyA2AToken(await registryBearerFromApp(), {});

    expect(identity.email).toBe("member@example.com");
  });
});
