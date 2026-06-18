import {
  getRequestOrgId,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  })),
}));

const setVisibilityMock = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: () => dbMock,
  schema: await vi.importActual("../server/db/schema.js"),
}));

vi.mock("./import-visual-plan-source.js", () => ({
  default: {
    run: vi.fn(async () => ({
      planId: "plan_answer",
      plan: {
        id: "plan_answer",
        kind: "plan",
        title: "Visual answer",
        brief: "Answer",
        content: { version: 2, blocks: [] },
      },
    })),
  },
}));

vi.mock("@agent-native/core/org", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/org")>();
  return {
    ...actual,
    resolveOrgIdForEmail: vi.fn(async () => null),
  };
});

vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    accessFilter: vi.fn(() => true),
    assertAccess: vi.fn(async () => ({ role: "owner", resource: {} })),
  };
});

vi.mock("@agent-native/core/sharing/actions/set-resource-visibility", () => ({
  default: setVisibilityMock,
}));

const { default: visualAnswer } = await import("./visual-answer.js");
const originalPlanLocalMode = process.env.PLAN_LOCAL_MODE;

describe("visual-answer action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLAN_LOCAL_MODE = "0";
    vi.mocked(resolveOrgIdForEmail).mockResolvedValue(null);
    setVisibilityMock.run.mockImplementation(async () => ({
      orgId: getRequestOrgId(),
    }));
  });

  afterEach(() => {
    if (originalPlanLocalMode === undefined) {
      delete process.env.PLAN_LOCAL_MODE;
    } else {
      process.env.PLAN_LOCAL_MODE = originalPlanLocalMode;
    }
  });

  it("falls back to the publisher's owner org for org-visible answers", async () => {
    vi.mocked(resolveOrgIdForEmail).mockResolvedValueOnce("org_owner");

    await runWithRequestContext({ userEmail: "owner@example.com" }, () =>
      visualAnswer.run({
        question: "What is the API shape?",
        visibility: "org",
        mdx: { "plan.mdx": "# API" },
      }),
    );

    expect(resolveOrgIdForEmail).toHaveBeenCalledWith("owner@example.com");
    expect(setVisibilityMock.run).toHaveBeenCalledWith({
      resourceType: "plan",
      resourceId: "plan_answer",
      visibility: "org",
    });
    await expect(setVisibilityMock.run.mock.results[0]?.value).resolves.toEqual(
      { orgId: "org_owner" },
    );
  });
});
