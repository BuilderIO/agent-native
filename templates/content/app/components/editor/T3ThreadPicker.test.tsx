// @vitest-environment happy-dom

import { T3_CODE_MENTION_ENGINE } from "@shared/comment-mentions";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { T3AgentRequest } from "@/hooks/use-t3-agents";

import { T3AgentRequestLine } from "./T3AgentRequestLine";
import { T3ThreadPicker } from "./T3ThreadPicker";

const threads = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: {
    isPending: true,
    isError: false,
    isSuccess: false,
    data: undefined as
      | { threads: { threadId: string; title: string }[] }
      | undefined,
  },
}));
const requests = vi.hoisted(() => ({ current: [] as T3AgentRequest[] }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${Object.values(values).join(" ")}` : key,
}));
vi.mock("@/hooks/use-t3-agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-t3-agents")>()),
  useT3AgentRequestsContext: () => ({
    agents: [],
    requests: requests.current,
    unreachable: false,
  }),
  useT3Threads: (...args: unknown[]) => {
    threads.calls.push(args);
    return threads.result;
  },
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const claudeCode = {
  kind: "agent",
  model: "claude-code",
  engine: T3_CODE_MENTION_ENGINE,
  provider: "T3 Code",
  name: "Claude Code",
} as const;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  threads.calls = [];
  threads.result = {
    isPending: true,
    isError: false,
    isSuccess: false,
    data: undefined,
  };
  requests.current = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

function renderPicker() {
  act(() =>
    root.render(
      <T3ThreadPicker
        mention={claudeCode}
        threadTitle={null}
        onChange={() => {}}
        onClose={() => {}}
      />,
    ),
  );
}

function openPicker() {
  const trigger = host.querySelector<HTMLButtonElement>(
    "[data-t3-thread-picker]",
  );
  if (!trigger) throw new Error("No thread picker");
  act(() => trigger.click());
}

describe("T3ThreadPicker", () => {
  it("loads recent threads before it is opened", () => {
    renderPicker();

    expect(threads.calls).toContainEqual(["claude-code", "", true]);
  });

  it("holds the list's room while recent threads load", () => {
    renderPicker();
    openPicker();

    const loading = document.querySelector("[data-t3-threads-loading]");
    expect(loading?.children).toHaveLength(8);
    expect(document.body.textContent).toContain("comments.t3OtherThreads");
  });

  it("swaps the placeholder rows for the threads once they arrive", () => {
    threads.result = {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { threads: [{ threadId: "thread-1", title: "Fix the sidebar" }] },
    };
    renderPicker();
    openPicker();

    expect(document.querySelector("[data-t3-threads-loading]")).toBeNull();
    expect(document.body.textContent).toContain("Fix the sidebar");
  });
});

describe("T3AgentRequestLine", () => {
  it("keeps a working request to one line, with the full status on hover and the link below", () => {
    requests.current = [
      {
        id: "request-1",
        documentId: "document-1",
        threadId: "discussion-1",
        commentId: "comment-1",
        agent: "claude-code",
        status: "working",
        t3ThreadId: "thread-1",
        t3ThreadTitle:
          "Tighten the comment sidebar's spacing on narrow screens",
        t3ThreadLink: "t3code://thread/1",
        replyCommentId: null,
        error: null,
        createdAt: "2026-11-27T12:00:00.000Z",
        updatedAt: "2026-11-27T12:00:00.000Z",
      },
    ];
    act(() => root.render(<T3AgentRequestLine commentId="comment-1" />));

    const line = host.querySelector('[data-t3-agent-request="working"]');
    const status = line?.querySelector<HTMLElement>("[title]");
    expect(status?.className).toContain("truncate");
    expect(status?.title).toBe(status?.textContent);
    expect(status?.title).toContain("Tighten the comment sidebar's spacing");
    const link = line?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("t3code://thread/1");
    expect(link?.parentElement).toBe(status?.parentElement);
  });
});
