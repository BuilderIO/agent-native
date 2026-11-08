import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestContext: vi.fn(),
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
});

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
        toolCalls: [
          { toolCallId: "call-draft1", name: "create-document", input: {} },
          {
            toolCallId: "call-delete",
            name: "delete-document",
            input: { id: "draft1" },
          },
        ],
        toolResults: [
          created("draft1", "Draft"),
          {
            toolCallId: "call-delete",
            name: "delete-document",
            content: '{"trashed":true}',
            isError: false,
          },
        ],
      }),
    ).toBeNull();
  });

  it("still asks for the link when the delete failed", () => {
    expect(
      guard({
        text: "The draft is ready.",
        toolCalls: [
          {
            toolCallId: "call-delete",
            name: "delete-document",
            input: { id: "draft1" },
          },
        ],
        toolResults: [
          created("draft1", "Draft"),
          {
            toolCallId: "call-delete",
            name: "delete-document",
            content: "Error: not found",
            isError: true,
          },
        ],
      }),
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

  it("falls back to the app-relative route without a request origin", () => {
    mocks.getRequestContext.mockReturnValue(undefined);

    expect(createdPageUrl("abc123XYZ")).toBe("/page/abc123XYZ");
  });
});
