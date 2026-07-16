import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  current: [] as Array<Record<string, unknown>>,
}));
const verifyToken = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  verifyScopedAgentAccessToken: (...args: unknown[]) => verifyToken(...args),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => rows.current }),
      }),
    }),
  }),
  schema: {
    documents: {
      id: "id",
      title: "title",
      content: "content",
      updatedAt: "updatedAt",
      visibility: "visibility",
    },
  },
}));

import action from "./get-public-document";

function privateDocument() {
  return {
    id: "doc-1",
    title: "Private notes",
    content: "Body",
    updatedAt: "2026-07-16T00:00:00.000Z",
    visibility: "private",
  };
}

describe("get-public-document", () => {
  beforeEach(() => {
    rows.current = [];
    verifyToken.mockReset();
    verifyToken.mockReturnValue({ ok: false });
  });

  it("is a no-store UI-only unauthenticated GET action", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.requiresAuth).toBe(false);
    expect(action.agentTool).toBe(false);
    expect(action.toolCallable).toBe(false);
    expect(action.readOnly).toBe(true);
  });

  it("returns a public document without a token", async () => {
    rows.current = [{ ...privateDocument(), visibility: "public" }];

    await expect(
      action.run({ id: "doc-1" }, {} as never),
    ).resolves.toMatchObject({
      id: "doc-1",
      content: "Body",
    });
  });

  it("returns a private document only for a valid document-scoped token", async () => {
    rows.current = [privateDocument()];
    verifyToken.mockReturnValue({ ok: true });

    await expect(
      action.run({ id: "doc-1", agent_access: "valid-token" }, {} as never),
    ).resolves.toMatchObject({ id: "doc-1" });
    expect(verifyToken).toHaveBeenCalledWith("valid-token", {
      resourceKind: "content:document",
      resourceId: "doc-1",
    });
  });

  it("uses one 404 shape for missing, private, and invalid or wrong-resource tokens", async () => {
    const cases = [
      { rows: [], args: { id: "doc-1" } },
      { rows: [privateDocument()], args: { id: "doc-1" } },
      {
        rows: [privateDocument()],
        args: { id: "doc-1", agent_access: "expired-or-wrong-resource" },
      },
    ];

    for (const testCase of cases) {
      rows.current = testCase.rows;
      await expect(
        action.run(testCase.args, {} as never),
      ).rejects.toMatchObject({
        message: "Document not found",
        statusCode: 404,
      });
    }
  });
});
