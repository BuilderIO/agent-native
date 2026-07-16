import { beforeEach, describe, expect, it, vi } from "vitest";

const readPrivateBlob = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const runWithRequestContext = vi.hoisted(() => vi.fn());
const verifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const resolveAccess = vi.hoisted(() => vi.fn());
const getRouterParam = vi.hoisted(() => vi.fn());
const getQuery = vi.hoisted(() => vi.fn());
const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const rows = vi.hoisted(() => ({
  current: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/private-blob", () => ({
  readPrivateBlob: (...args: unknown[]) => readPrivateBlob(...args),
}));
vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  getSession: (...args: unknown[]) => getSession(...args),
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    verifyScopedAgentAccessToken(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => resolveAccess(...args),
}));
vi.mock("drizzle-orm", () => ({ eq: (...args: unknown[]) => args }));
vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => getQuery(...args),
  getRouterParam: (...args: unknown[]) => getRouterParam(...args),
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("../../../../shared/agent-readable.js", () => ({
  DOCUMENT_AGENT_RESOURCE_KIND: "document",
}));
vi.mock("../../../db/index.js", () => ({
  schema: {
    documentMedia: {
      id: "documentMedia.id",
      documentId: "documentMedia.documentId",
      state: "documentMedia.state",
    },
    documents: { id: "documents.id", visibility: "documents.visibility" },
  },
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => rows.current }) }),
    }),
  }),
}));

import handler from "./[id].get";

const media = {
  id: "media-1",
  documentId: "doc-1",
  state: "active",
  mimeType: "image/png",
  blobHandleJson: '{"id":"provider-secret","provider":"vercel","opaque":true}',
};

describe("GET /api/document-media/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rows.current = [media];
    getRouterParam.mockReturnValue("media-1");
    getQuery.mockReturnValue({ agent_access: "valid-token" });
    verifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    getSession.mockResolvedValue(null);
    readPrivateBlob.mockResolvedValue({
      data: Buffer.from("raw-bytes"),
      mimeType: "image/png",
    });
  });

  it("returns raw private bytes for a valid scoped token with hardening headers", async () => {
    const result = await handler({} as never);

    expect(result).toEqual(Buffer.from("raw-bytes"));
    expect(setResponseHeader).toHaveBeenCalledWith(
      {},
      "Cache-Control",
      "no-store",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      {},
      "Referrer-Policy",
      "no-referrer",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      {},
      "X-Content-Type-Options",
      "nosniff",
    );
    expect(setResponseHeader).toHaveBeenCalledWith(
      {},
      "Content-Type",
      "image/png",
    );
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  it("allows an owner or share-authorized session", async () => {
    getQuery.mockReturnValue({});
    getSession.mockResolvedValue({
      email: "owner@example.com",
      orgId: "org-1",
    });
    resolveAccess.mockResolvedValue({ role: "viewer" });

    await expect(handler({} as never)).resolves.toEqual(
      Buffer.from("raw-bytes"),
    );
    expect(resolveAccess).toHaveBeenCalledWith("document", "doc-1");
  });

  it("uses one indistinguishable 404 for unknown, revoked, invalid, unrelated, and missing blobs", async () => {
    const cases = [
      { rows: [], query: {}, session: null, readFails: false },
      {
        rows: [{ ...media, state: "revoked" }],
        query: {},
        session: null,
        readFails: false,
      },
      {
        rows: [media],
        query: { agent_access: "bad" },
        session: null,
        readFails: false,
      },
      {
        rows: [media],
        query: {},
        session: { email: "other@example.com" },
        readFails: false,
      },
      {
        rows: [media],
        query: { agent_access: "valid-token" },
        session: null,
        readFails: true,
      },
    ];
    const results = [];
    for (const testCase of cases) {
      rows.current = testCase.rows;
      getQuery.mockReturnValue(testCase.query);
      getSession.mockResolvedValue(testCase.session);
      verifyScopedAgentAccessToken.mockReturnValue({
        ok: testCase.query.agent_access === "valid-token",
      });
      resolveAccess.mockResolvedValue(null);
      readPrivateBlob.mockImplementation(async () => {
        if (testCase.readFails) throw new Error("missing blob");
        return { data: Buffer.from("raw-bytes"), mimeType: "image/png" };
      });
      results.push(await handler({} as never));
    }

    expect(results).toEqual(Array(5).fill({ error: "Document not found" }));
    expect(setResponseStatus).toHaveBeenCalledTimes(5);
    expect(setResponseStatus).toHaveBeenLastCalledWith({}, 404);
  });
});
