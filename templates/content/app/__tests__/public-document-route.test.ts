import { createElement } from "react";
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

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
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

import { renderToStaticMarkup } from "react-dom/server";

import { AgentReadableDocumentDiscovery, loader, meta } from "../routes/p.$id";

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

  it("emits hidden MCP guidance without adding an accessible control", () => {
    const html = renderToStaticMarkup(
      createElement(AgentReadableDocumentDiscovery, {
        document: { id: "doc-1" },
        basePath: "/content",
        origin: "https://content.example.test",
        accessState: "authentication-required",
      }),
    );

    expect(html).toContain('class="hidden"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("https://content.example.test/content/mcp/connect");
    expect(html).toContain("get-document");
    expect(html).toContain("Agent-Native Content access record");
    expect(html).toContain(
      "https://www.agent-native.com/docs/external-agents/#private-content-links",
    );
    expect(html).toContain(
      "Adding a connection changes the user&#x27;s agent configuration and is the user&#x27;s choice",
    );
    expect(html).toContain(
      "does not grant new document access. The connected account&#x27;s permission for this document has not been evaluated",
    );
    expect(html).not.toContain("add this instance");
    expect(html).not.toContain("and retry");
    expect(html).not.toContain("tell the user");
    expect(html).not.toContain("Do not ask");
    expect(html).not.toContain("button");
    expect(html).not.toContain("Launch notes");
    expect(html).not.toContain("Ship it");
  });

  it("does not disclose private document fields to an anonymous share-page request", async () => {
    resultQueue.current = [documentRows("private")];

    const result = await loader(requestFor());

    expect(result).toMatchObject({
      document: null,
      unavailable: {
        reason: "private",
        id: "doc-1",
      },
    });
    expect(JSON.stringify(result)).not.toContain("Launch notes");
    expect(JSON.stringify(result)).not.toContain("Ship it");
  });

  it("advertises the agent context endpoint for private share pages", () => {
    const descriptors = meta({
      loaderData: {
        document: null,
        agentAccessToken: null,
        basePath: "/content",
        origin: "https://content.example.test",
        unavailable: {
          reason: "private",
          id: "doc-1",
          basePath: "/content",
        },
      },
    } as never);

    expect(descriptors).toContainEqual({
      tagName: "link",
      rel: "alternate",
      type: "application/agent-native+json",
      href: "/content/api/document-agent-context.json?id=doc-1",
      title: "Agent-readable Content document",
    });
  });

  it("uses document-aware social images only for public documents", () => {
    const publicMeta =
      meta({
        loaderData: {
          document: {
            id: "doc-1",
            title: "Launch notes",
            content: "## Summary\n\n- Ship it",
            visibility: "public",
          },
          agentAccessToken: null,
          basePath: "/content",
          origin: "https://content.example.test",
        },
      } as never) ?? [];
    const imageDescriptor = publicMeta.find(
      (item): item is { property: string; content: string } =>
        "property" in item && "content" in item && item.property === "og:image",
    );
    if (!imageDescriptor) throw new Error("Public document image is missing");
    const image = new URL(imageDescriptor.content);

    expect(image.pathname).toBe("/content/_agent-native/og-image.png");
    expect(image.searchParams.get("title")).toBe("Launch notes");
    expect(image.searchParams.get("accentText")).toContain("Ship it");

    const privateMeta =
      meta({
        loaderData: {
          document: null,
          agentAccessToken: null,
          basePath: "/content",
          origin: "https://content.example.test",
          unavailable: {
            reason: "private",
            id: "doc-1",
            basePath: "/content",
          },
        },
      } as never) ?? [];

    expect(
      privateMeta.some(
        (item) => "property" in item && item.property === "og:image",
      ),
    ).toBe(false);
    expect(JSON.stringify(privateMeta)).not.toContain("Launch notes");
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
      origin: "https://content.example.test",
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
      origin: "https://content.example.test",
    });
  });
});
