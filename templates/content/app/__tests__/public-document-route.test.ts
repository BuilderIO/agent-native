import { beforeEach, describe, expect, it, vi } from "vitest";

const resultQueue = vi.hoisted(() => ({ current: [] as unknown[][] }));
const limit = vi.hoisted(() =>
  vi.fn(async () => resultQueue.current.shift() ?? []),
);
const where = vi.hoisted(() => vi.fn(() => ({ limit })));
const from = vi.hoisted(() => vi.fn(() => ({ where })));
const select = vi.hoisted(() => vi.fn(() => ({ from })));
const configuredBasePath = vi.hoisted(() => ({ current: "" }));
const mockVerifyScopedAgentAccessToken = vi.hoisted(() =>
  vi.fn((_token: unknown, _options: unknown) => ({ ok: false })),
);

vi.mock("@/components/editor/VisualEditor", () => ({
  VisualEditor: () => null,
}));

vi.mock("@agent-native/core/client", () => ({
  agentNativePath: (path: string) => path,
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/server", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  getConfiguredAppBasePath: () => configuredBasePath.current,
  getRequestUserEmail: () => null,
  verifyScopedAgentAccessToken: (token: unknown, options: unknown) =>
    mockVerifyScopedAgentAccessToken(token, options),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

vi.mock("../../server/db", () => ({
  getDb: () => ({ select }),
  schema: {
    documents: {
      id: "id_col",
      title: "title_col",
      content: "content_col",
      updatedAt: "updated_at_col",
      visibility: "visibility_col",
    },
  },
}));

import { loader } from "../routes/p.$id";

function requestFor(id = "doc-1", token?: string) {
  const url = new URL(`https://content.example.test/p/${id}`);
  if (token) url.searchParams.set("agent_access", token);
  return {
    params: { id },
    request: new Request(url),
  } as any;
}

function documentRows(visibility: "public" | "private" | "org") {
  return [
    {
      id: "doc-1",
      title: "Launch notes",
      content: "## Summary\n\n- Ship it",
      updatedAt: "2026-01-02T03:04:05.000Z",
      visibility,
    },
  ];
}

describe("public document route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configuredBasePath.current = "";
    resultQueue.current = [];
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: false });
  });

  it("serves a public document without private loader headers", async () => {
    resultQueue.current = [documentRows("public")];

    const result = await loader(requestFor());

    expect(result).toMatchObject({
      document: {
        id: "doc-1",
        title: "Launch notes",
      },
      agentAccessToken: null,
      basePath: "",
    });
    expect((result as any).type).not.toBe("DataWithResponseInit");
    expect(where).toHaveBeenCalledWith({ column: "id_col", value: "doc-1" });
  });

  it("marks tokenized document pages private and no-store", async () => {
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    resultQueue.current = [documentRows("private")];

    const result = (await loader(requestFor("doc-1", "tok+1"))) as any;

    expect(mockVerifyScopedAgentAccessToken).toHaveBeenCalledWith("tok+1", {
      resourceKind: "content:document",
      resourceId: "doc-1",
    });
    expect(result.type).toBe("DataWithResponseInit");
    expect(result.init.headers).toEqual({
      "Cache-Control": "private, max-age=0, no-store",
      "Referrer-Policy": "no-referrer",
    });
    expect(result.data).toMatchObject({
      document: { id: "doc-1", title: "Launch notes" },
      agentAccessToken: "tok+1",
      basePath: "",
    });
  });
});
