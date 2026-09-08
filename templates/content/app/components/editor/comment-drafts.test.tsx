// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  CommentDraftProvider,
  useCommentDraft,
  useCommentPanelSession,
  type CommentDraft,
} from "./comment-drafts";

describe("comment drafts", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let currentDraft: ReturnType<typeof useCommentDraft> | null = null;
  let currentPanel: ReturnType<typeof useCommentPanelSession> | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    currentDraft = null;
    currentPanel = null;
    window.localStorage.clear();
  });

  function Probe({
    draftKey,
    initial,
  }: {
    draftKey: string;
    initial?: CommentDraft;
  }) {
    currentDraft = useCommentDraft(draftKey, initial);
    currentPanel = useCommentPanelSession();
    return <div>{currentDraft.draft.text}</div>;
  }

  function render(args: {
    documentId?: string;
    email?: string;
    draftKey?: string;
    initial?: CommentDraft;
    showProbe?: boolean;
  }) {
    container ??= document.createElement("div");
    if (!container.isConnected) document.body.appendChild(container);
    root ??= createRoot(container);
    act(() => {
      root!.render(
        <CommentDraftProvider
          documentId={args.documentId ?? "document-a"}
          currentUserEmail={args.email ?? "person@example.com"}
        >
          {args.showProbe === false ? null : (
            <Probe
              draftKey={args.draftKey ?? "reply:thread-a"}
              initial={args.initial}
            />
          )}
        </CommentDraftProvider>,
      );
    });
  }

  it("preserves drafts and filter context while presentation children remount", () => {
    render({});
    act(() => {
      currentDraft!.setText((text) => `${text}kept reply`);
      currentDraft!.setMentions((mentions) => [
        ...mentions,
        { email: "reviewer@example.com", name: "Reviewer" },
      ]);
      currentPanel!.setHistoryStatus("resolved");
      currentPanel!.setHistoryAuthor("reviewer@example.com");
      currentPanel!.setHistoryScrollTop(184);
    });

    render({ showProbe: false });
    render({});

    expect(currentDraft!.draft).toMatchObject({
      text: "kept reply",
      mentions: [{ email: "reviewer@example.com", name: "Reviewer" }],
    });
    expect(currentPanel).toMatchObject({
      historyStatus: "resolved",
      historyAuthor: "reviewer@example.com",
      historyScrollTop: 184,
    });
  });

  it("clears only the submitted revision when a delayed request settles", () => {
    render({});
    act(() => currentDraft!.setText("submitted text"));
    const submitted = currentDraft!.draft;
    act(() => currentDraft!.setText("newer text"));
    act(() => currentDraft!.clearIfUnchanged(submitted));
    expect(currentDraft!.draft.text).toBe("newer text");

    const newer = currentDraft!.draft;
    act(() => currentDraft!.clearIfUnchanged(newer));
    expect(currentDraft!.draft).toMatchObject({ text: "", mentions: [] });
  });

  it("preserves a new revision that returns to the submitted text", () => {
    render({});
    act(() => currentDraft!.setText("A"));
    const submitted = currentDraft!.markSubmitted();
    act(() => currentDraft!.setText("B"));
    act(() => currentDraft!.setText("A"));
    expect(currentDraft!.draft.revision).toBeGreaterThan(submitted.revision);
    act(() => currentDraft!.clearIfUnchanged(submitted));
    expect(currentDraft!.draft.text).toBe("A");
  });

  it("retains the submitted mentions across remount and replaces them on resubmit", () => {
    render({});
    act(() => currentDraft!.setText("Hello @Reviewer"));
    const submitted = currentDraft!.markSubmitted();
    act(() =>
      currentDraft!.setMentions([
        { email: "reviewer@example.com", name: "Reviewer" },
      ]),
    );
    render({ showProbe: false });
    render({});
    expect(currentDraft!.submittedDraft).toBe(submitted);
    expect(submitted.mentions).toEqual([]);
    act(() => currentDraft!.clearIfUnchanged(currentDraft!.submittedDraft!));
    expect(currentDraft!.draft.mentions).toHaveLength(1);
    const resubmitted = currentDraft!.markSubmitted();
    render({});
    expect(currentDraft!.submittedDraft).toBe(resubmitted);
    act(() => currentDraft!.clearIfUnchanged(resubmitted));
    expect(currentDraft!.draft.text).toBe("");
  });

  it("clears document-session state across document or account changes", () => {
    render({});
    act(() => {
      currentDraft!.setText("private draft");
      currentPanel!.setHistoryStatus("open");
    });

    render({ documentId: "document-b" });
    expect(currentDraft!.draft.text).toBe("");
    expect(currentPanel!.historyStatus).toBe("open");

    act(() => currentDraft!.setText("second private draft"));
    render({ documentId: "document-b", email: "other@example.com" });
    expect(currentDraft!.draft.text).toBe("");
  });

  it("remembers status for each page and account after remount, without saving drafts", () => {
    render({});
    expect(currentPanel).toMatchObject({
      historyStatus: "open",
      historyAuthor: null,
    });
    act(() => {
      currentPanel!.setHistoryStatus("all");
      currentDraft!.setText("temporary");
    });
    act(() => root!.unmount());
    root = null;
    render({});
    expect(currentPanel!.historyStatus).toBe("all");
    expect(currentDraft!.draft.text).toBe("");
    render({ documentId: "document-b" });
    expect(currentPanel!.historyStatus).toBe("open");
    render({ email: "other@example.com" });
    expect(currentPanel!.historyStatus).toBe("open");
    render({ email: " PERSON@example.com " });
    expect(currentPanel!.historyStatus).toBe("all");
  });

  it("keeps independent drafts for thread and edit keys", () => {
    function SwitchingProbe() {
      const [key, setKey] = useState("reply:thread-a");
      currentDraft = useCommentDraft(key);
      return <button onClick={() => setKey("edit:comment-b")}>{key}</button>;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <CommentDraftProvider documentId="document-a">
          <SwitchingProbe />
        </CommentDraftProvider>,
      );
    });
    act(() => currentDraft!.setText("reply draft"));
    act(() =>
      (container!.querySelector("button") as HTMLButtonElement).click(),
    );
    act(() => currentDraft!.setText("edit draft"));
    expect(currentDraft!.draft.text).toBe("edit draft");
    act(() => currentDraft!.discard());
    expect(currentDraft!.draft.text).toBe("");
  });

  it("uses the latest server value after an edit draft is cleared", () => {
    render({
      draftKey: "edit:comment-a",
      initial: { text: "original", mentions: [] },
    });
    act(() => currentDraft!.setText("saved edit"));
    const submitted = currentDraft!.draft;
    act(() => currentDraft!.clearIfUnchanged(submitted));

    render({
      draftKey: "edit:comment-a",
      initial: { text: "new server value", mentions: [] },
    });
    expect(currentDraft!.draft.text).toBe("new server value");
  });
});
