// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CommentsSidebar,
  useCommentReplyDrafts,
  usePendingCommentDraft,
  type PendingCommentSelection,
} from "./CommentsSidebar";

const { createComment, notifyError } = vi.hoisted(() => ({
  createComment: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({
    mutateAsync: (payload: unknown) =>
      new Promise((resolve, reject) =>
        createComment(payload, { onSuccess: resolve, onError: reject }),
      ),
    isPending: false,
  }),
  useResolveComment: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-mention-members", () => ({
  useMentionMembers: () => ({
    data: [{ email: "reviewer@example.test", name: "Reviewer" }],
  }),
}));
vi.mock("sonner", () => ({ toast: { error: notifyError } }));

type Pending = PendingCommentSelection;
const selected: Pending = {
  quotedText: "better",
  offsetTop: 80,
  anchor: {
    quotedText: "better",
    prefix: "A ",
    suffix: " paragraph.",
    startOffset: 2,
  },
  range: { from: 3, to: 9 },
};

describe("new comment responsive draft", () => {
  let container: HTMLDivElement;
  let root: Root;
  let start: (pending: Pending | null) => void;
  let owner!: ReturnType<typeof usePendingCommentDraft>;
  const completed = vi.fn();

  function Owner({
    width,
    documentId = "document-one",
    canComment = true,
  }: {
    width: number;
    documentId?: string;
    canComment?: boolean;
  }) {
    const {
      pendingComment,
      setPendingComment,
      changePendingComment,
      completePendingComment,
    } = usePendingCommentDraft(documentId);
    owner = {
      pendingComment,
      setPendingComment,
      changePendingComment,
      completePendingComment,
    };
    start = setPendingComment;
    const replyDrafts = useCommentReplyDrafts(documentId);
    const sidebar = (
      <CommentsSidebar
        documentId={documentId}
        replyDrafts={replyDrafts}
        pendingComment={pendingComment}
        onPendingChange={changePendingComment}
        canComment={canComment}
        compact={width < 800}
        alignToAnchors={width >= 800}
        forceVisible
        onPendingDone={(id, threadId) => {
          if (completePendingComment(id)) completed(threadId);
        }}
      />
    );
    return (
      <>
        <button data-outside>Outside</button>
        {width < 800 ? (
          <section key="anchored">{sidebar}</section>
        ) : (
          <aside key="rail">{sidebar}</aside>
        )}
      </>
    );
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    createComment.mockReset();
    completed.mockReset();
    notifyError.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const settle = async () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 75));
    });
  const input = () => container.querySelector("textarea")!;
  const show = async (width: number, documentId = "document-one") => {
    await act(async () =>
      root.render(<Owner width={width} documentId={documentId} />),
    );
    await settle();
  };
  const open = async (pending = selected) => {
    await act(async () => start(pending));
    await settle();
  };
  const type = async (value: string) => {
    const node = input();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(node, value);
      node.setSelectionRange(value.length, value.length);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input().value).toBe(value);
  };
  const press = async (key: string) =>
    act(async () => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
  const addMention = async () => {
    await type("Mobile @Rev");
    await press("Enter");
    await settle();
    expect(input().value).toBe("Mobile @Reviewer ");
  };
  const submit = async () => {
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "comments.submit",
    )!;
    await act(async () => button.click());
  };

  it("keeps real typed text, mention payload and selected anchor across mobile/compact/desktop/mobile", async () => {
    await show(390);
    await open();
    await addMention();
    await type("Mobile @Reviewer baseline comment");
    await show(768);
    expect(input().value).toBe("Mobile @Reviewer baseline comment");
    await show(1280);
    expect(input().value).toBe("Mobile @Reviewer baseline comment");
    await show(390);
    expect(input().value).toBe("Mobile @Reviewer baseline comment");
    expect(owner.pendingComment).toMatchObject({
      quotedText: selected.quotedText,
      anchor: selected.anchor,
      range: selected.range,
    });
    await submit();
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      documentId: "document-one",
      content: "Mobile @Reviewer baseline comment",
      quotedText: "better",
      anchorPrefix: "A ",
      anchorSuffix: " paragraph.",
      anchorStartOffset: 2,
      mentions: JSON.stringify([
        { email: "reviewer@example.test", name: "Reviewer" },
      ]),
    });
  });

  it("restores a focused backward selection so resumed typing replaces the intended text", async () => {
    await show(390);
    await open();
    await type("Mobile baseline comment");
    input().focus();
    input().setSelectionRange(7, 15, "backward");
    input().dispatchEvent(new Event("select"));
    await show(1280);
    expect(document.activeElement).toBe(input());
    expect([
      input().selectionStart,
      input().selectionEnd,
      input().selectionDirection,
    ]).toEqual([7, 15, "backward"]);
    await type(
      input().value.slice(0, input().selectionStart) +
        "updated" +
        input().value.slice(input().selectionEnd),
    );
    expect(input().value).toBe("Mobile updated comment");
  });

  it("does not steal deliberately moved focus on a responsive remount", async () => {
    await show(390);
    await open();
    await type("Keep this draft");
    const outside =
      container.querySelector<HTMLButtonElement>("[data-outside]")!;
    outside.focus();
    await show(1280);
    expect(document.activeElement).toBe(outside);
    expect(input().value).toBe("Keep this draft");
  });

  it("retains a failed submission, clears success and explicitly starts a fresh selection", async () => {
    await show(390);
    await open();
    await type("Retry this comment");
    await submit();
    await act(async () =>
      createComment.mock.calls[0]![1].onError(new Error("offline")),
    );
    expect(input().value).toBe("Retry this comment");
    expect(completed).not.toHaveBeenCalled();
    await submit();
    await act(async () =>
      createComment.mock.calls[1]![1].onSuccess({ threadId: "created-thread" }),
    );
    expect(container.querySelector("textarea")).toBeNull();
    expect(completed).toHaveBeenCalledWith("created-thread");
    await open({
      ...selected,
      quotedText: "other",
      range: { from: 20, to: 25 },
    });
    expect(input().value).toBe("");
    await type("Cancel this comment");
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "comments.cancel")!
        .click(),
    );
    expect(container.querySelector("textarea")).toBeNull();
    await open();
    expect(input().value).toBe("");
  });

  it("isolates document drafts and does not preserve text when a new selection replaces one", async () => {
    await show(390);
    await open();
    await addMention();
    await open({ ...selected, quotedText: "replacement" });
    expect(input().value).toBe("");
    await type("Other selection draft");
    await show(390, "document-two");
    expect(container.querySelector("textarea")).toBeNull();
    await open();
    expect(input().value).toBe("");
    await type("Document two draft");
    await submit();
    expect(createComment.mock.calls[0]![0]).toMatchObject({
      documentId: "document-two",
      content: "Document two draft",
      mentions: undefined,
    });
  });

  it.each(["success", "failure"] as const)(
    "does not let an older %s dismiss a new selection",
    async (outcome) => {
      await show(390);
      await open();
      await type("Old comment");
      await submit();
      const oldSubmission = createComment.mock.calls[0]![1];
      await open({
        ...selected,
        quotedText: "new selection",
        range: { from: 30, to: 43 },
      });
      await type("New comment");
      await act(async () =>
        outcome === "success"
          ? oldSubmission.onSuccess({ threadId: "old-thread" })
          : oldSubmission.onError(new Error("late error")),
      );
      expect(input().value).toBe("New comment");
      expect(completed).not.toHaveBeenCalled();
      expect(owner.pendingComment).toMatchObject({
        quotedText: "new selection",
        range: { from: 30, to: 43 },
      });
    },
  );

  it("does not complete a previous document's submission over the next document", async () => {
    await show(390);
    await open();
    await type("Old document comment");
    await submit();
    const oldSubmission = createComment.mock.calls[0]![1];
    await show(1280, "document-two");
    await open();
    await type("Current document comment");
    await act(async () =>
      oldSubmission.onSuccess({ threadId: "old-document-thread" }),
    );
    expect(input().value).toBe("Current document comment");
    expect(owner.pendingComment?.documentId).toBe("document-two");
    expect(completed).not.toHaveBeenCalled();
  });

  it("focuses a fresh draft once and does not submit after comment permission is revoked", async () => {
    await show(390);
    await open();
    expect(document.activeElement).toBe(input());
    await type("Permission changed");
    await act(async () =>
      root.render(<Owner width={390} canComment={false} />),
    );
    await submit();
    expect(createComment).not.toHaveBeenCalled();
    expect(input().value).toBe("Permission changed");
  });

  it("keeps an in-flight submission disabled through remount and retains it on failure", async () => {
    await show(390);
    await open();
    await type("Pending comment");
    await submit();
    await show(1280);
    expect(input().value).toBe("Pending comment");
    expect(input().disabled).toBe(true);
    await submit();
    expect(createComment).toHaveBeenCalledTimes(1);
    await act(async () =>
      createComment.mock.calls[0]![1].onError(new Error("offline")),
    );
    expect(input().disabled).toBe(false);
    expect(input().value).toBe("Pending comment");
  });

  it("does not refocus or replace a native selection on text-only owner updates", async () => {
    await show(390);
    await open();
    await type("Keep the caret");
    input().setSelectionRange(5, 8, "backward");
    input().dispatchEvent(new Event("select"));
    const focus = vi.spyOn(input(), "focus");
    await act(async () =>
      owner.changePendingComment(owner.pendingComment!.id, () => ({
        mentions: [],
      })),
    );
    await settle();
    expect(focus).not.toHaveBeenCalled();
    expect([
      input().selectionStart,
      input().selectionEnd,
      input().selectionDirection,
    ]).toEqual([5, 8, "backward"]);
  });

  it("does not steal focus moved after remount but before deferred restoration", async () => {
    await show(390);
    await open();
    await type("Keep this draft");
    await act(async () => root.render(<Owner width={1280} />));
    const outside =
      container.querySelector<HTMLButtonElement>("[data-outside]")!;
    outside.focus();
    await settle();
    expect(document.activeElement).toBe(outside);
  });

  it("wires the production document owner through every responsive sidebar", () => {
    const source = readFileSync(
      new NodeURL("./DocumentEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("usePendingCommentDraft(documentId)");
    expect(source).toContain("pendingComment={pendingComment}");
    expect(source).toContain("onPendingChange={changePendingComment}");
    expect(source).toContain("if (!completePendingComment(id)) return;");
    expect(source).not.toMatch(
      /\[pendingComment,\s*setPendingComment\]\s*=\s*useState/,
    );
  });
});
