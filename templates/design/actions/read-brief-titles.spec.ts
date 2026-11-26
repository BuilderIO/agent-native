import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reader: undefined as string | undefined,
  invoke: vi.fn(),
  resolveTarget: vi.fn(),
  designUrl: undefined as string | undefined,
  contentMount: "",
  AgentInvocationError: class extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("../../../packages/core/src/a2a/caller-auth.js", () => ({
  resolveA2ACallerAuth: async () => ({
    userEmail: mocks.reader,
    metadata: {},
  }),
}));
vi.mock("../../../packages/core/src/a2a/invoke.js", () => ({
  invokeAgentAction: mocks.invoke,
}));
vi.mock("@agent-native/core/a2a", async () => ({
  ...(await import("../../../packages/core/src/a2a/link-summary.js")),
  AgentInvocationError: mocks.AgentInvocationError,
  resolveAgentInvocationTarget: mocks.resolveTarget,
}));
vi.mock("@agent-native/core/server", () => ({
  getAppConfig: () => ({ app: { url: mocks.designUrl } }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.reader,
}));

import { answerLinkSummaries } from "../../../packages/core/src/a2a/link-summary.js";
import readBriefTitles from "./read-brief-titles";

const CONTENT = "https://content.agent-native.com";
const CONTENT_BETA = "https://beta.content.agent-native.com";

const TITLES: Record<string, Record<string, string>> = {
  "alice@example.test": { launch: "Launch brief", other: "Other brief" },
  "bob@example.test": { other: "Other brief" },
};

function connectContent(url: string) {
  mocks.resolveTarget.mockReset();
  mocks.resolveTarget.mockResolvedValue({
    kind: "discovered",
    id: "content",
    name: "Content",
    url,
  });
}

beforeEach(() => {
  mocks.reader = "alice@example.test";
  mocks.designUrl = "https://design.agent-native.com";
  mocks.contentMount = "";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  connectContent(CONTENT);
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(
    async (options: { input: { links: string[] }; userEmail: string }) => ({
      target: { kind: "discovered", name: "content", url: "" },
      result: {
        status: "completed",
        output: JSON.stringify(
          await answerLinkSummaries({
            app: "content",
            links: options.input.links,
            basePath: mocks.contentMount,
            readTitle: async ({ id }) =>
              TITLES[options.userEmail]?.[id] ?? null,
          }),
        ),
      },
    }),
  );
});

function page(title: string, url: string) {
  return { status: "available", app: "content", kind: "page", title, url };
}

describe("read-brief-titles", () => {
  it("asks Content once, as the reader, and answers in order", async () => {
    await expect(
      readBriefTitles.run({ ids: ["other", "missing", "launch"] }),
    ).resolves.toEqual({
      summaries: [
        page("Other brief", `${CONTENT}/page/other`),
        { status: "unavailable" },
        page("Launch brief", `${CONTENT}/page/launch`),
      ],
    });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "content",
        selfAppId: "design",
        action: "read-link-summary",
        userEmail: "alice@example.test",
      }),
    );
  });

  it("gives a reader who can't open a page no title for it", async () => {
    mocks.reader = "bob@example.test";
    await expect(
      readBriefTitles.run({ ids: ["launch", "other"] }),
    ).resolves.toEqual({
      summaries: [
        { status: "unavailable" },
        page("Other brief", `${CONTENT}/page/other`),
      ],
    });
  });

  it("asks the Content in its own lane", async () => {
    mocks.designUrl = "https://beta.design.agent-native.com";
    await expect(readBriefTitles.run({ ids: ["launch"] })).resolves.toEqual({
      summaries: [page("Launch brief", `${CONTENT_BETA}/page/launch`)],
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ target: CONTENT_BETA }),
    );
  });

  it.each([
    ["https://workspace.example.test/content/", "a mounted workspace app"],
    [
      "https://workspace.example.test/content/_agent-native/a2a",
      "a Content connected by its agent endpoint",
    ],
  ])("links pages in the Content that answers, at %s: %s", async (url) => {
    connectContent(url);
    mocks.contentMount = "/content";
    await expect(readBriefTitles.run({ ids: ["launch"] })).resolves.toEqual({
      summaries: [
        page(
          "Launch brief",
          "https://workspace.example.test/content/page/launch",
        ),
      ],
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ target: "content" }),
    );
  });

  it("keeps a stored id inside its own link", async () => {
    await expect(
      readBriefTitles.run({ ids: ["../../settings", "launch?x=1", "launch"] }),
    ).resolves.toEqual({
      summaries: [
        { status: "unavailable" },
        { status: "unavailable" },
        page("Launch brief", `${CONTENT}/page/launch`),
      ],
    });
  });

  it("makes no call for a signed-out reader", async () => {
    mocks.reader = undefined;
    await expect(readBriefTitles.run({ ids: ["launch"] })).resolves.toEqual({
      summaries: [{ status: "unavailable" }],
    });
    expect(mocks.resolveTarget).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("makes no call when no Content is connected", async () => {
    mocks.resolveTarget.mockRejectedValue(
      new mocks.AgentInvocationError(
        "not-found",
        'Error: Agent "content" not found.',
      ),
    );
    await expect(
      readBriefTitles.run({ ids: ["launch", "other"] }),
    ).resolves.toEqual({
      summaries: [{ status: "unavailable" }, { status: "unavailable" }],
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("fails when it can't read which apps are connected", async () => {
    mocks.resolveTarget.mockRejectedValue(
      new mocks.AgentInvocationError(
        "discovery-failed",
        "Error: Could not read connected-agent sources.",
      ),
    );
    await expect(readBriefTitles.run({ ids: ["launch"] })).rejects.toThrow(
      "Could not read connected-agent sources",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("answers unavailable when Content can't be reached", async () => {
    mocks.invoke.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(readBriefTitles.run({ ids: ["launch"] })).resolves.toEqual({
      summaries: [{ status: "unavailable" }],
    });
  });

  it("keeps titles out of the browser's saved results", () => {
    expect(readBriefTitles.persistInBrowser).toBe(false);
  });

  it("refuses more pages than a design keeps", () => {
    const ids = Array.from({ length: 6 }, (_, index) => `page-${index}`);
    expect(readBriefTitles.schema.safeParse({ ids }).success).toBe(false);
    expect(readBriefTitles.schema.safeParse({ ids: [] }).success).toBe(false);
  });
});
