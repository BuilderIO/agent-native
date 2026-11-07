import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), invoke: vi.fn() }));
vi.mock("./caller-auth.js", () => ({ resolveA2ACallerAuth: mocks.auth }));
vi.mock("./invoke.js", () => ({ invokeAgentAction: mocks.invoke }));

import { readPeerComposerSource } from "./composer-source.js";

const request = {
  source: "slides",
  operation: "read",
  id: "deck-example",
  page: 1,
} as const;
const reference = {
  id: "deck-example",
  title: "Example deck",
  context: "Bounded layout reference",
};
const peer = {
  kind: "discovered",
  name: "Slides",
  url: "https://slides.example.com",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    userEmail: "member@example.com",
    orgDomain: "example.com",
    orgSecret: "test-only-org-secret",
  });
  mocks.invoke.mockResolvedValue({
    target: peer,
    result: { status: "completed", output: JSON.stringify(reference) },
  });
});

describe("readPeerComposerSource", () => {
  it("calls only the discovered owner action with the request identity", async () => {
    expect(await readPeerComposerSource(request, "design")).toEqual(reference);
    expect(mocks.invoke).toHaveBeenCalledWith({
      target: "slides",
      selfAppId: "design",
      action: "read-composer-source",
      input: request,
      userEmail: "member@example.com",
      orgDomain: "example.com",
      orgSecret: "test-only-org-secret",
      requestTimeoutMs: 15000,
    });
  });

  it("routes Figma reads to Design without copying provider credentials", async () => {
    mocks.invoke.mockResolvedValue({
      target: peer,
      result: {
        status: "completed",
        output: JSON.stringify({ items: [], hasMore: false }),
      },
    });
    await readPeerComposerSource(
      {
        source: "figma",
        operation: "list",
        figmaUrl: "https://www.figma.com/design/exampleFile",
        page: 1,
      },
      "slides",
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ target: "design", selfAppId: "slides" }),
    );
  });

  it("routes Content pages to Content and anchors relative links to it", async () => {
    mocks.invoke.mockResolvedValue({
      target: {
        kind: "discovered",
        name: "Content",
        url: "https://apps.example.com/content/",
      },
      result: {
        status: "completed",
        output: JSON.stringify({
          id: "page-example",
          title: "Launch brief",
          url: "/content/_agent-native/open?view=editor&documentId=page-example",
          context: "Brief",
        }),
      },
    });
    const pageRequest = {
      source: "content",
      operation: "read",
      id: "page-example",
      page: 1,
    } as const;
    expect(await readPeerComposerSource(pageRequest, "design")).toMatchObject({
      url: "https://apps.example.com/content/_agent-native/open?view=editor&documentId=page-example",
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ target: "content", selfAppId: "design" }),
    );

    mocks.invoke.mockResolvedValue({
      target: {
        kind: "discovered",
        name: "Content",
        url: "https://content.example.com",
      },
      result: {
        status: "completed",
        output: JSON.stringify({
          items: [{ id: "page-example", title: "Launch brief", url: "/page" }],
          hasMore: false,
        }),
      },
    });
    expect(
      await readPeerComposerSource(
        { source: "content", operation: "list", page: 1 },
        "slides",
      ),
    ).toEqual({
      items: [
        {
          id: "page-example",
          title: "Launch brief",
          url: "https://content.example.com/page",
        },
      ],
      hasMore: false,
    });
  });

  it("keeps absolute peer links as they are", async () => {
    mocks.invoke.mockResolvedValue({
      target: {
        kind: "discovered",
        name: "Content",
        url: "https://content.example.com",
      },
      result: {
        status: "completed",
        output: JSON.stringify({
          id: "page-example",
          title: "Launch brief",
          url: "https://elsewhere.example.com/page",
          context: "Brief",
        }),
      },
    });
    expect(
      await readPeerComposerSource(
        { source: "content", operation: "read", id: "page-example", page: 1 },
        "design",
      ),
    ).toMatchObject({ url: "https://elsewhere.example.com/page" });
  });

  it("requires authentication before discovery or network work", async () => {
    mocks.auth.mockResolvedValue({});
    await expect(
      readPeerComposerSource(request, "design"),
    ).rejects.toMatchObject({ errorCode: "unauthorized", statusCode: 401 });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects self invocation", async () => {
    await expect(
      readPeerComposerSource(request, "slides"),
    ).rejects.toMatchObject({ errorCode: "composer_source_local" });
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("does not turn a network error into empty references", async () => {
    mocks.invoke.mockRejectedValue(new Error("socket hang up"));
    await expect(
      readPeerComposerSource(request, "design"),
    ).rejects.toMatchObject({ errorCode: "composer_peer_unavailable" });
  });

  it("rejects a failed peer even when its output looks like a reference", async () => {
    mocks.invoke.mockResolvedValue({
      result: { status: "failed", output: JSON.stringify(reference) },
    });
    await expect(
      readPeerComposerSource(request, "design"),
    ).rejects.toMatchObject({ errorCode: "composer_reference_unavailable" });
  });

  it("marks Figma read failures without exposing provider details", async () => {
    mocks.invoke.mockResolvedValue({
      result: {
        status: "failed",
        output:
          'Figma files request failed: {"status":403,"err":"provider detail sentinel"} (errorCode: figma_auth_required)',
      },
    });

    await expect(
      readPeerComposerSource(
        {
          source: "figma",
          operation: "read",
          figmaUrl: "https://www.figma.com/design/exampleFile?node-id=1-2",
          page: 1,
        },
        "slides",
      ),
    ).rejects.toMatchObject({
      errorCode: "composer_reference_unavailable",
      details: { source: "figma" },
    });
  });

  it.each([
    "not json",
    JSON.stringify({ ...reference, context: "x".repeat(20001) }),
    JSON.stringify({ ...reference, id: "different-deck" }),
    JSON.stringify({ items: [], hasMore: false }),
  ])(
    "rejects malformed, oversized, mismatched, or wrong-kind read responses",
    async (output) => {
      mocks.invoke.mockResolvedValue({
        result: { status: "completed", output },
      });
      await expect(
        readPeerComposerSource(request, "design"),
      ).rejects.toMatchObject({ errorCode: "composer_peer_invalid_response" });
    },
  );

  it("preserves list pagination", async () => {
    const list = {
      items: [{ id: "deck-example", title: "Example deck" }],
      hasMore: true,
      nextCursor: "example-cursor",
    };
    mocks.invoke.mockResolvedValue({
      target: peer,
      result: { status: "completed", output: JSON.stringify(list) },
    });
    expect(
      await readPeerComposerSource({ ...request, operation: "list" }, "design"),
    ).toEqual(list);
  });
});
