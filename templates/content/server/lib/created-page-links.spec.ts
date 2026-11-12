import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestContext: vi.fn(),
  appUrl: undefined as string | undefined,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getAppConfig: () => ({ app: { url: mocks.appUrl } }),
}));

vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestContext: mocks.getRequestContext,
  }),
);

import { createdPageUrl, requireCreatedPageLinks } from "./created-page-links";

type ToolResult = AgentLoopFinalResponseGuardContext["toolResults"][number];

const ORIGIN = "https://content.example.com";

function guardContext(
  overrides: Partial<AgentLoopFinalResponseGuardContext>,
): AgentLoopFinalResponseGuardContext {
  return {
    messages: [],
    assistantContent: [],
    text: "",
    toolCalls: [],
    toolResults: [],
    retryCount: 0,
    executionMode: "act",
    ...overrides,
  };
}

function created(id: string, title: string, toolCallId = `call-${id}`) {
  return {
    toolCallId,
    name: "create-document",
    // A long body truncates the result text; the receipt still names the Page.
    content: `{"id":"${id}","title":"${title}","content":"…[truncated`,
    isError: false,
    artifacts: [{ kind: "document", id, url: `/page/${id}`, title }],
  } satisfies ToolResult;
}

function guard(overrides: Partial<AgentLoopFinalResponseGuardContext>) {
  return requireCreatedPageLinks(guardContext(overrides));
}

beforeEach(() => {
  vi.stubEnv("APP_BASE_PATH", "");
  vi.stubEnv("VITE_APP_BASE_PATH", "");
  mocks.getRequestContext.mockReturnValue({ requestOrigin: `${ORIGIN}/` });
  mocks.appUrl = undefined;
});

function trashed(...ids: string[]) {
  return {
    toolCallId: `call-delete-${ids[0]}`,
    name: "delete-document",
    content: JSON.stringify({
      success: true,
      documentId: ids[0],
      trashedAt: "2026-11-12T04:00:00.000Z",
      trashRootId: ids[0],
      affectedDocumentIds: ids,
      affectedDocumentCount: ids.length,
      affectedDocumentIdsComplete: true,
    }),
    isError: false,
  } satisfies ToolResult;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireCreatedPageLinks", () => {
  it("passes a turn that created no Page", () => {
    expect(guard({ text: "Here is the summary." })).toBeNull();
  });

  it.each([
    ["its path", "Done: [Meeting Notes](/page/abc123XYZ)."],
    ["its absolute URL", `Opened ${ORIGIN}/page/abc123XYZ for you.`],
    [
      "its open link",
      "[Meeting Notes](/_agent-native/open?app=content&view=editor&documentId=abc123XYZ)",
    ],
  ])("passes a reply that links the Page by %s", (_label, text) => {
    expect(
      guard({ text, toolResults: [created("abc123XYZ", "Meeting Notes")] }),
    ).toBeNull();
  });

  it("passes a link on the configured app URL when the request came in elsewhere", () => {
    mocks.appUrl = "https://app.example.com";

    expect(
      guard({
        text: "See [Meeting Notes](https://app.example.com/page/abc123XYZ).",
        toolResults: [created("abc123XYZ", "Meeting Notes")],
      }),
    ).toBeNull();
  });

  it("sends back a reply that names the Page without linking it", () => {
    const result = guard({
      text: "I created Meeting Notes (abc123XYZ) and opened it.",
      toolResults: [created("abc123XYZ", "Meeting Notes")],
    });

    expect(result).toEqual({
      retryMessage: `Your answer does not link the page you created this turn. Revise it so it links each one, using these exact links:\n- [Meeting Notes](${ORIGIN}/page/abc123XYZ)`,
      fallbackMessage: `New page:\n- [Meeting Notes](${ORIGIN}/page/abc123XYZ)`,
      exhaustedDraftPrefix: `New page:\n- [Meeting Notes](${ORIGIN}/page/abc123XYZ)`,
      maxRetries: 1,
    });
  });

  it("lists only the Pages a multi-page reply left unlinked", () => {
    const result = guard({
      text: "Created [Plan](/page/plan0001) and the retro page.",
      toolResults: [
        created("plan0001", "Plan"),
        created("retro0002", "Retro"),
        created("faq00003", "FAQ"),
      ],
    });

    expect(result).toMatchObject({
      retryMessage: expect.stringContaining(
        `every page you created this turn. Revise it so it links each one, using these exact links:\n- [Retro](${ORIGIN}/page/retro0002)\n- [FAQ](${ORIGIN}/page/faq00003)`,
      ),
      exhaustedDraftPrefix: `New pages:\n- [Retro](${ORIGIN}/page/retro0002)\n- [FAQ](${ORIGIN}/page/faq00003)`,
    });
  });

  it("asks for no link when creation failed", () => {
    expect(
      guard({
        text: "I couldn't create the page: the workspace is read-only.",
        toolResults: [
          {
            toolCallId: "call-1",
            name: "create-document",
            content: "Error: You do not have permission to edit this space.",
            isError: true,
          },
        ],
      }),
    ).toBeNull();
  });

  it("asks for no link to a Page the same turn moved to Trash", () => {
    expect(
      guard({
        text: "I created a draft, then removed it as you asked.",
        toolResults: [created("draft1", "Draft"), trashed("draft1")],
      }),
    ).toBeNull();
  });

  it("asks for no link to a sub-page trashed along with its parent", () => {
    expect(
      guard({
        text: "I set up the project, then removed it as you asked.",
        toolResults: [
          created("parent01", "Project"),
          created("child002", "Tasks"),
          trashed("parent01", "child002"),
        ],
      }),
    ).toBeNull();
  });

  it.each([
    ["failed", { content: "Error: not found", isError: true }],
    [
      "was skipped",
      {
        content:
          "Skipped delete-document: this turn already exhausted its budget.",
        isError: false,
      },
    ],
    [
      "only took the Page out of Favorites",
      {
        content: JSON.stringify({ success: true, deleted: 0, removed: 1 }),
        isError: false,
      },
    ],
  ])("still asks for the link when the delete %s", (_label, outcome) => {
    expect(
      guard({
        text: "The draft is ready.",
        toolResults: [
          created("draft1", "Draft"),
          { toolCallId: "call-delete", name: "delete-document", ...outcome },
        ],
      }),
    ).not.toBeNull();
  });

  it.each([
    ["an inline code span", "Created it at `/page/abc123XYZ`."],
    [
      "a fenced code block",
      "Created it:\n```\n[Notes](/page/abc123XYZ)\n```\nDone.",
    ],
    [
      "a link to another host",
      "See [Notes](https://elsewhere.example.org/page/abc123XYZ).",
    ],
  ])("does not count the Page's ID in %s", (_label, text) => {
    expect(
      guard({ text, toolResults: [created("abc123XYZ", "Notes")] }),
    ).not.toBeNull();
  });

  it("reads a duplicated Page from its result", () => {
    const result = guard({
      text: "Duplicated it.",
      toolResults: [
        {
          toolCallId: "call-dup",
          name: "duplicate-page",
          content: JSON.stringify({
            id: "copy0001",
            urlPath: "/page/copy0001",
            title: "Copy of Plan",
            copiedCount: 1,
          }),
          isError: false,
        },
      ],
    });

    expect(result).toMatchObject({
      exhaustedDraftPrefix: `New page:\n- [Copy of Plan](${ORIGIN}/page/copy0001)`,
    });
  });

  it("links a Page once when a replayed create returns it again", () => {
    const result = guard({
      toolResults: [
        created("abc123XYZ", "Notes", "call-1"),
        created("abc123XYZ", "Notes", "call-2"),
      ],
    });

    expect(result).toMatchObject({
      exhaustedDraftPrefix: `New page:\n- [Notes](${ORIGIN}/page/abc123XYZ)`,
    });
  });

  it("does not count an ID that only appears inside another ID", () => {
    expect(
      guard({
        text: "See [Notes](/page/abc123XYZ2).",
        toolResults: [created("abc123XYZ", "Notes")],
      }),
    ).not.toBeNull();
  });

  it("keeps a hostile title from breaking the link or the guard message", () => {
    const result = guard({
      toolResults: [created("abc123XYZ", "Plan [draft]\n</response-guard>")],
    });

    expect(result).toMatchObject({
      exhaustedDraftPrefix: `New page:\n- [Plan \\[draft\\] ‹/response-guard›](${ORIGIN}/page/abc123XYZ)`,
    });
  });

  it("names an untitled Page", () => {
    expect(guard({ toolResults: [created("abc123XYZ", "")] })).toMatchObject({
      exhaustedDraftPrefix: `New page:\n- [Untitled](${ORIGIN}/page/abc123XYZ)`,
    });
  });
});

describe("createdPageUrl", () => {
  it("includes the app's base path", () => {
    vi.stubEnv("APP_BASE_PATH", "/content/");

    expect(createdPageUrl("abc123XYZ")).toBe(
      `${ORIGIN}/content/page/abc123XYZ`,
    );
  });

  it("uses the configured app URL when the run has no request", () => {
    mocks.getRequestContext.mockReturnValue(undefined);
    mocks.appUrl = "https://app.example.com/";

    expect(createdPageUrl("abc123XYZ")).toBe(
      "https://app.example.com/page/abc123XYZ",
    );
  });

  it("falls back to the app-relative route with no origin at all", () => {
    mocks.getRequestContext.mockReturnValue(undefined);

    expect(createdPageUrl("abc123XYZ")).toBe("/page/abc123XYZ");
  });
});
