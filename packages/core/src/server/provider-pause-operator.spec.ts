import { beforeEach, describe, expect, it, vi } from "vitest";

// The deployment's declaration and the caller's memberships are the two inputs; everything else is the gate.
const state = vi.hoisted(() => ({
  config: {
    operatorEmails: [] as string[],
    operatorOrgId: undefined as string | undefined,
  },
  configThrows: false,
  memberships: [] as Array<{ orgId: string; role: string }> | null,
}));

vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => {
    if (state.configThrows) throw new Error("config unavailable");
    return { providerPause: state.config };
  },
}));
vi.mock("../org/context.js", () => ({
  listOrgMemberships: vi.fn(async () => state.memberships),
}));

import {
  PROVIDER_PAUSE_FORBIDDEN,
  assertProviderPauseOperator,
  isProviderPauseOperator,
} from "./provider-pause-operator.js";

const DECLARED = "operator@example.test";
const DEPLOYMENT_ORG = "org-deployment";

async function refusal(
  caller: Parameters<typeof assertProviderPauseOperator>[0],
) {
  let caught: unknown;
  try {
    await assertProviderPauseOperator(caller);
  } catch (error) {
    caught = error;
  }
  return (caught ?? {}) as { errorCode?: string; statusCode?: number };
}

describe("provider pause operator check", () => {
  beforeEach(() => {
    state.configThrows = false;
    state.config = { operatorEmails: [DECLARED], operatorOrgId: undefined };
    state.memberships = [];
  });

  it("admits the deployment's declared operator email", async () => {
    await expect(
      assertProviderPauseOperator({
        userEmail: "Operator@Example.Test",
        orgId: "org-anything",
      }),
    ).resolves.toBeUndefined();
    expect(await isProviderPauseOperator({ userEmail: DECLARED })).toBe(true);
  });

  it("refuses a stranger who owns only the organization signing in created for them", async () => {
    // This is the shape that broke the first cut: a brand-new person is the owner of their own org.
    state.config = { operatorEmails: [], operatorOrgId: DEPLOYMENT_ORG };
    state.memberships = [{ orgId: "org-auto-created", role: "owner" }];
    const caught = await refusal({
      userEmail: "stranger@example.test",
      orgId: "org-auto-created",
    });
    expect(caught.errorCode).toBe(PROVIDER_PAUSE_FORBIDDEN);
    expect(caught.statusCode).toBe(403);
  });

  it("refuses an admin of some other organization when no organization is selected", async () => {
    state.config = { operatorEmails: [], operatorOrgId: DEPLOYMENT_ORG };
    state.memberships = [{ orgId: "org-other", role: "admin" }];
    const caught = await refusal({
      userEmail: "admin@example.test",
      orgId: null,
    });
    expect(caught.errorCode).toBe(PROVIDER_PAUSE_FORBIDDEN);
    expect(caught.statusCode).toBe(403);
  });

  it("admits an owner or admin of the one organization the deployment names", async () => {
    state.config = { operatorEmails: [], operatorOrgId: DEPLOYMENT_ORG };
    state.memberships = [{ orgId: DEPLOYMENT_ORG, role: "admin" }];
    await expect(
      assertProviderPauseOperator({
        userEmail: "orgadmin@example.test",
        orgId: DEPLOYMENT_ORG,
      }),
    ).resolves.toBeUndefined();
    state.memberships = [{ orgId: DEPLOYMENT_ORG, role: "member" }];
    expect(
      await isProviderPauseOperator({ userEmail: "member@example.test" }),
    ).toBe(false);
  });

  it("refuses everyone when the deployment declares no operator at all", async () => {
    state.config = { operatorEmails: [], operatorOrgId: undefined };
    state.memberships = [{ orgId: "org-deployment", role: "owner" }];
    const caught = await refusal({
      userEmail: "owner@example.test",
      orgId: "org-deployment",
    });
    expect(caught.errorCode).toBe(PROVIDER_PAUSE_FORBIDDEN);
    expect(
      await isProviderPauseOperator({ userEmail: "owner@example.test" }),
    ).toBe(false);
  });

  it("fails closed and says the declaration was unreadable, distinctly from undeclared", async () => {
    state.configThrows = true;
    let caught: unknown;
    try {
      await assertProviderPauseOperator({ userEmail: DECLARED });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      errorCode: PROVIDER_PAUSE_FORBIDDEN,
      statusCode: 403,
      details: { reason: "config-unreadable" },
    });
    state.configThrows = false;
    const anonymous = await refusal({});
    expect(anonymous.errorCode).toBe(PROVIDER_PAUSE_FORBIDDEN);
    expect(anonymous.statusCode).toBe(403);
  });
});
