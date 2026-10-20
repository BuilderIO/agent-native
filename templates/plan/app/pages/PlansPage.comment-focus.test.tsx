// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import type { RuntimeAnnotation } from "@/lib/plan-annotation-runtime";

import { AnnotationPopover, CommentMentionEditor } from "./PlansPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

function editor() {
  return container.querySelector<HTMLElement>('[contenteditable="true"]')!;
}

function render(focusKey?: unknown) {
  act(() =>
    root.render(
      <>
        <button type="button" data-outside />
        <CommentMentionEditor
          placeholder="Add a comment"
          autoFocus
          focusKey={focusKey}
          onChange={() => {}}
        />
      </>,
    ),
  );
}

describe("comment editor focus", () => {
  it("takes focus back from a menu that still traps it on mount", async () => {
    const outside = () =>
      container.querySelector<HTMLButtonElement>("[data-outside]")!;
    // Like a closing Radix menu: the first time focus leaves, pull it back.
    let trapped = true;
    const trap = (event: FocusEvent) => {
      if (!trapped || event.target === outside()) return;
      trapped = false;
      outside().focus();
    };
    document.addEventListener("focusin", trap);
    try {
      render();
      expect(document.activeElement).toBe(outside());
      await settle();
      expect(document.activeElement).toBe(editor());
    } finally {
      document.removeEventListener("focusin", trap);
    }
  });

  it("puts the caret back in a moved draft without clearing it", async () => {
    render({ x: 1 });
    await settle();
    editor().textContent = "Tighten this step";
    container.querySelector<HTMLButtonElement>("[data-outside]")!.focus();

    render({ x: 2 });

    expect(document.activeElement).toBe(editor());
    expect(editor().textContent).toBe("Tighten this step");
  });
});

function annotation(id: string): RuntimeAnnotation {
  return {
    id,
    index: 1,
    message: `Thread ${id}`,
    kind: "comment",
    status: "open",
    createdBy: "author@example.com",
    authorEmail: "author@example.com",
    anchor: { x: 0, y: 0 } as RuntimeAnnotation["anchor"],
    replies: [],
    participants: [],
    commentCount: 1,
  };
}

function renderPopover(
  thread: RuntimeAnnotation,
  onReply: (
    threadRootId: string,
    message: string,
  ) => Promise<void> = async () => {},
) {
  act(() =>
    root.render(
      <AnnotationPopover
        annotation={thread}
        position={{ left: 0, top: 0, pinLeft: 0, pinTop: 0, width: 320 }}
        isPending={false}
        pendingAuthor={{
          name: "Viewer",
          email: "viewer@example.com",
          initials: "V",
          color: "#888",
          avatarUrl: null,
        }}
        canComment
        canEditRootComment={false}
        onSave={() => {}}
        onReply={onReply}
        canResolve={false}
        onStatusChange={() => {}}
        canDelete={false}
        onDelete={() => {}}
        canDeleteComment={() => false}
        onDeleteComment={() => {}}
      />,
    ),
  );
}

function sendReply() {
  return act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="plansPage.comments.sendReply"]',
      )!
      .click();
  });
}

function typeReply(text: string) {
  act(() => {
    editor().textContent = text;
    editor().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("thread popover reply", () => {
  it("keeps each thread's unsent reply with that thread", async () => {
    renderPopover(annotation("a"));
    await settle();
    typeReply("Reply for A");

    renderPopover(annotation("b"));
    await settle();
    expect(document.activeElement).toBe(editor());
    expect(editor().textContent).toBe("");
    typeReply("Reply for B");

    renderPopover(annotation("a"));
    await settle();
    expect(document.activeElement).toBe(editor());
    expect(editor().textContent).toBe("Reply for A");
  });

  it("forgets a thread's reply once it is sent", async () => {
    renderPopover(annotation("a"));
    await settle();
    typeReply("Reply for A");
    await sendReply();

    renderPopover(annotation("b"));
    await settle();
    renderPopover(annotation("a"));
    await settle();
    expect(editor().textContent).toBe("");
  });

  it("doesn't offer a reply again while it is still sending", async () => {
    let finishSending = () => {};
    const onReply = () =>
      new Promise<void>((resolve) => {
        finishSending = resolve;
      });
    renderPopover(annotation("a"), onReply);
    await settle();
    typeReply("Reply for A");
    await sendReply();

    renderPopover(annotation("b"), onReply);
    await settle();
    renderPopover(annotation("a"), onReply);
    await settle();
    expect(editor().textContent).toBe("");
    await act(async () => finishSending());
  });

  it("keeps what you type while a reply sends", async () => {
    let finishSending = () => {};
    const onReply = () =>
      new Promise<void>((resolve) => {
        finishSending = resolve;
      });
    renderPopover(annotation("a"), onReply);
    await settle();
    typeReply("Reply for A");
    await sendReply();
    typeReply("Next thought");
    await act(async () => finishSending());

    expect(editor().textContent).toBe("Next thought");
  });

  it("brings back a reply that fails after you leave its thread", async () => {
    let failSending = () => {};
    const onReply = () =>
      new Promise<void>((_resolve, reject) => {
        failSending = () => reject(new Error("offline"));
      });
    renderPopover(annotation("a"), onReply);
    await settle();
    typeReply("Reply for A");
    await sendReply();
    renderPopover(annotation("b"), onReply);
    await settle();
    typeReply("Reply for B");
    await act(async () => failSending());

    expect(editor().textContent).toBe("Reply for B");
    renderPopover(annotation("a"), onReply);
    await settle();
    expect(editor().textContent).toBe("Reply for A");
    expect(container.textContent).toContain("plansPage.comments.sendFailed");
  });

  it("puts a failed reply ahead of a newer draft", async () => {
    let failSending = () => {};
    const onReply = () =>
      new Promise<void>((_resolve, reject) => {
        failSending = () => reject(new Error("offline"));
      });
    renderPopover(annotation("a"), onReply);
    await settle();
    typeReply("Reply for A");
    await sendReply();
    typeReply("and more");
    await act(async () => failSending());

    expect(editor().textContent).toBe("Reply for A and more");
  });

  it("brings a reply back to its thread when sending fails", async () => {
    const onReply = () => Promise.reject(new Error("offline"));
    renderPopover(annotation("a"), onReply);
    await settle();
    typeReply("Reply for A");
    await sendReply();

    renderPopover(annotation("b"), onReply);
    await settle();
    renderPopover(annotation("a"), onReply);
    await settle();
    expect(editor().textContent).toBe("Reply for A");
  });
});
