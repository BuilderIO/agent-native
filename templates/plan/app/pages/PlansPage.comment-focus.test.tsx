// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/toolkit/app/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/review")
  >()),
  useReviewMentionPeople: () => ({
    people: [{ label: "Pat", email: "pat@example.com" }],
    searching: false,
    failed: false,
    onMentionQueryChange: () => {},
  }),
}));

import type { RuntimeAnnotation } from "@/lib/plan-annotation-runtime";

import { AnnotationPopover, InlineCommentPopover } from "./PlansPage";

type EditorElement = HTMLElement & {
  editor: {
    commands: { focus: (position: "end") => boolean };
    state: {
      doc: { content: { size: number } };
      tr: { insertText: (text: string, from?: number, to?: number) => unknown };
    };
    view: { dispatch: (transaction: unknown) => void };
  };
};

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
  const found = container.querySelector<EditorElement>(".ProseMirror");
  if (!found) throw new Error("No comment box on screen");
  return found;
}

function submitButton() {
  const found = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (!found) throw new Error("No send button on screen");
  return found;
}

function typeText(text: string) {
  act(() => {
    editor().editor.commands.focus("end");
  });
  act(() => {
    const { state, view } = editor().editor;
    view.dispatch(state.tr.insertText(text));
  });
}

type InlineAnchor = ComponentProps<typeof InlineCommentPopover>["anchor"];

function inlineComment(
  anchor: object,
  reopened = false,
  onCancel: () => void = () => {},
) {
  return (
    <InlineCommentPopover
      anchor={anchor as InlineAnchor}
      position={{ left: 0, top: 0, pinLeft: 0, pinTop: 0, width: 320 }}
      initialDraft={{ message: "", mentions: [], resolutionTarget: "agent" }}
      onCancel={onCancel}
      onSubmit={async () => {}}
      reopened={reopened}
    />
  );
}

function render(anchor: object = { x: 1 }) {
  act(() =>
    root.render(
      <>
        <button type="button" data-outside />
        {inlineComment(anchor)}
      </>,
    ),
  );
}

describe("comment box focus", () => {
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
      await settle();
      expect(trapped).toBe(false);
      expect(document.activeElement).toBe(editor());
    } finally {
      document.removeEventListener("focusin", trap);
    }
  });

  function renderReopened(showBox: boolean) {
    act(() =>
      root.render(
        <>
          <button type="button" data-outside />
          {showBox && inlineComment({ x: 1 }, true)}
        </>,
      ),
    );
  }

  it("takes focus when a box reopens and nobody holds it", async () => {
    renderReopened(true);
    await settle();
    expect(document.activeElement).toBe(editor());
  });

  it("leaves focus where the person moved when a box reopens", async () => {
    renderReopened(false);
    const outside =
      container.querySelector<HTMLButtonElement>("[data-outside]")!;
    outside.focus();
    renderReopened(true);
    await settle();
    expect(document.activeElement).toBe(outside);
  });

  it("puts the caret back in a moved draft without clearing it", async () => {
    render({ x: 1 });
    await settle();
    typeText("Tighten this step");
    container.querySelector<HTMLButtonElement>("[data-outside]")!.focus();

    render({ x: 2 });
    await settle();

    expect(document.activeElement).toBe(editor());
    expect(editor().textContent).toBe("Tighten this step");
  });

  it("cancels the new comment on Escape", async () => {
    const onCancel = vi.fn();
    act(() => root.render(inlineComment({ x: 1 }, false, onCancel)));
    await settle();
    typeText("Not this one");

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      editor().dispatchEvent(escape);
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps a comment for a person once its mention is deleted", async () => {
    act(() =>
      root.render(
        <InlineCommentPopover
          anchor={{ x: 1 } as InlineAnchor}
          position={{ left: 0, top: 0, pinLeft: 0, pinTop: 0, width: 320 }}
          initialDraft={{
            message: "@[Pat](mailto:pat%40example.com) look here",
            mentions: [],
            resolutionTarget: "agent",
          }}
          onCancel={() => {}}
          onSubmit={async () => {}}
        />,
      ),
    );
    await settle();
    expect(submitButton().disabled).toBe(false);

    act(() => {
      const { state, view } = editor().editor;
      view.dispatch(
        state.tr.insertText("Just a note", 1, state.doc.content.size - 1),
      );
    });
    await settle();

    expect(editor().textContent).toBe("Just a note");
    expect(submitButton().disabled).toBe(true);
    expect(container.textContent).toContain(
      "plansPage.comments.mentionRequired",
    );
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
        reactionsFor={() => []}
        showReactions={false}
        canReact={false}
        onReact={() => {}}
      />,
    ),
  );
}

function sendReply() {
  return act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click();
  });
}

const typeReply = typeText;

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
    expect(submitButton().disabled).toBe(true);
    await act(async () => finishSending());

    expect(editor().textContent).toBe("Next thought");
    expect(submitButton().disabled).toBe(false);
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

  it("shows each thread's own send failure", async () => {
    const onReply = () => Promise.reject(new Error("offline"));
    for (const id of ["a", "b"]) {
      renderPopover(annotation(id), onReply);
      await settle();
      typeReply(`Reply for ${id}`);
      await sendReply();
    }

    renderPopover(annotation("a"), onReply);
    await settle();
    expect(editor().textContent).toBe("Reply for a");
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
    expect(document.activeElement).toBe(editor());
  });

  it("leaves focus alone when a send fails after you moved on", async () => {
    let failSending = () => {};
    const onReply = () =>
      new Promise<void>((_resolve, reject) => {
        failSending = () => reject(new Error("offline"));
      });
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    try {
      renderPopover(annotation("a"), onReply);
      await settle();
      typeReply("Reply for A");
      await sendReply();
      await settle();
      elsewhere.focus();
      await act(async () => failSending());
      await settle();

      expect(editor().textContent).toBe("Reply for A");
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
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
