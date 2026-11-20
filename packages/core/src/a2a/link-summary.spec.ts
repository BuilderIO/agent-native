import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), invoke: vi.fn() }));
vi.mock("./caller-auth.js", () => ({ resolveA2ACallerAuth: mocks.auth }));
vi.mock("./invoke.js", () => ({ invokeAgentAction: mocks.invoke }));

import { answerLinkSummaries, readPeerLinkSummaries } from "./link-summary.js";

const DESIGN = "https://design.example.com/design/d1";
const OTHER = "https://design.example.com/design/d2";
const available = {
  status: "available",
  app: "design",
  kind: "design",
  title: "Launch page",
  url: DESIGN,
} as const;
const peer = {
  kind: "discovered",
  name: "Design",
  url: "https://design.example.com",
} as const;

function answer(output: unknown, status = "completed") {
  mocks.invoke.mockResolvedValue({
    target: peer,
    result: {
      status,
      output: typeof output === "string" ? output : JSON.stringify(output),
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.auth.mockResolvedValue({
    userEmail: "reader@example.com",
    orgDomain: "example.com",
    orgSecret: "test-only-org-secret",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("readPeerLinkSummaries", () => {
  it("asks the owning app's action as the signed-in reader", async () => {
    answer({ summaries: [available, { status: "unavailable" }] });
    await expect(
      readPeerLinkSummaries({
        app: "design",
        links: [DESIGN, OTHER],
        selfAppId: "content",
      }),
    ).resolves.toEqual([available, { status: "unavailable" }]);
    expect(mocks.invoke).toHaveBeenCalledWith({
      target: "design",
      selfAppId: "content",
      action: "read-link-summary",
      input: { links: [DESIGN, OTHER] },
      userEmail: "reader@example.com",
      orgDomain: "example.com",
      orgSecret: "test-only-org-secret",
      requestTimeoutMs: 5000,
    });
  });

  it("makes no call for a signed-out reader", async () => {
    mocks.auth.mockResolvedValue({ metadata: {} });
    await expect(
      readPeerLinkSummaries({
        app: "design",
        links: [DESIGN],
        selfAppId: "content",
      }),
    ).resolves.toEqual([{ status: "unavailable" }]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("answers unavailable when the peer can't be reached", async () => {
    mocks.invoke.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(
      readPeerLinkSummaries({
        app: "design",
        links: [DESIGN],
        selfAppId: "content",
      }),
    ).resolves.toEqual([{ status: "unavailable" }]);
  });

  it("answers unavailable when the peer is slower than the card waits", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockReturnValue(new Promise(() => {}));
    const pending = readPeerLinkSummaries({
      app: "slides",
      links: [DESIGN],
      selfAppId: "content",
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual([{ status: "unavailable" }]);
  });

  it("answers unavailable when the peer refuses", async () => {
    answer("Unknown or unavailable read-only action.", "failed");
    await expect(
      readPeerLinkSummaries({
        app: "design",
        links: [DESIGN],
        selfAppId: "content",
      }),
    ).resolves.toEqual([{ status: "unavailable" }]);
  });

  it.each([
    ["text that isn't JSON", '{"summaries": ['],
    ["a different count", { summaries: [available, available] }],
    [
      "extra fields on unavailable",
      { summaries: [{ status: "unavailable", title: "Private" }] },
    ],
    ["the wrong shape", { items: [] }],
  ])("answers unavailable for %s", async (_label, output) => {
    answer(output);
    await expect(
      readPeerLinkSummaries({
        app: "design",
        links: [DESIGN],
        selfAppId: "content",
      }),
    ).resolves.toEqual([{ status: "unavailable" }]);
  });

  it("drops an answer about another app, kind, or link", async () => {
    answer({
      summaries: [
        { ...available, app: "slides", kind: "deck" },
        { ...available, kind: "recording" },
        { ...available, url: DESIGN },
      ],
    });
    await expect(
      readPeerLinkSummaries({
        app: "design",
        links: [DESIGN, DESIGN, OTHER],
        selfAppId: "content",
      }),
    ).resolves.toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
  });
});

describe("answerLinkSummaries", () => {
  it("answers each link from the caller's own read, in order", async () => {
    const readTitle = vi.fn(async ({ id }: { id: string }) =>
      id === "d1" ? "  Launch\n page " : null,
    );
    await expect(
      answerLinkSummaries({
        app: "design",
        links: [DESIGN, OTHER],
        basePath: "",
        readTitle,
      }),
    ).resolves.toEqual({
      summaries: [
        { ...available, title: "Launch page" },
        { status: "unavailable" },
      ],
    });
    expect(readTitle).toHaveBeenCalledWith({
      app: "design",
      id: "d1",
      route: "design",
    });
  });

  it("answers a missing, private, malformed, or failing link the same way", async () => {
    const readTitle = vi.fn(async ({ id }: { id: string }) => {
      if (id === "boom") throw new Error("database is down");
      return null;
    });
    const result = await answerLinkSummaries({
      app: "design",
      links: [
        "https://design.example.com/design/missing",
        "https://design.example.com/design/boom",
        "https://design.example.com/settings",
        "not a link",
      ],
      basePath: "",
      readTitle,
    });
    expect(result.summaries).toEqual([
      { status: "unavailable" },
      { status: "unavailable" },
      { status: "unavailable" },
      { status: "unavailable" },
    ]);
    expect(readTitle).toHaveBeenCalledTimes(2);
  });

  it("reads links below the app's own mount path", async () => {
    const readTitle = vi.fn(async () => "Q3 review");
    const result = await answerLinkSummaries({
      app: "slides",
      links: [
        "https://workspace.example.com/slides/deck/k1/present",
        "https://workspace.example.com/deck/k1",
      ],
      basePath: "/slides",
      readTitle,
    });
    expect(result.summaries).toEqual([
      {
        status: "available",
        app: "slides",
        kind: "deck",
        title: "Q3 review",
        url: "https://workspace.example.com/slides/deck/k1/present",
      },
      { status: "unavailable" },
    ]);
  });
});
