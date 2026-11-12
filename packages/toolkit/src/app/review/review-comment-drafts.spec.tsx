// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as DraftsModule from "./review-comment-drafts.js";

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: vi.fn(),
}));

const image = {
  url: "https://cdn.builder.io/api/v1/image/shot",
  name: "shot.png",
  contentType: "image/png",
};

let resourceCount = 0;

describe("useReviewCommentDraft", () => {
  let container: HTMLDivElement;
  let root: Root;
  let drafts: typeof DraftsModule;
  let scope: DraftsModule.ReviewCommentDraftScope;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    // Each test starts as a fresh page load, with nothing read yet.
    vi.resetModules();
    drafts = await import("./review-comment-drafts.js");
    resourceCount += 1;
    scope = {
      resourceType: "design",
      resourceId: `design-${resourceCount}`,
      userEmail: "Alice@Example.com",
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function mount(
    boxes: Array<{
      key: string | null;
      initial?: DraftsModule.ReviewCommentDraft;
      scope?: DraftsModule.ReviewCommentDraftScope | null;
    }>,
  ) {
    const states: DraftsModule.ReviewCommentDraftState[] = [];
    function Box({
      index,
      box,
    }: {
      index: number;
      box: (typeof boxes)[number];
    }) {
      states[index] = drafts.useReviewCommentDraft(
        box.scope === undefined ? scope : box.scope,
        box.key,
        box.initial,
      );
      return null;
    }
    act(() =>
      root.render(
        <>
          {boxes.map((box, index) => (
            <Box key={index} index={index} box={box} />
          ))}
        </>,
      ),
    );
    return states;
  }

  function stored() {
    const key = drafts.reviewCommentDraftStorageKey(scope)!;
    const raw = window.localStorage.getItem(key);
    return raw
      ? (JSON.parse(raw) as { drafts: Record<string, unknown> })
      : null;
  }

  async function reload() {
    act(() => root.render(null));
    vi.resetModules();
    drafts = await import("./review-comment-drafts.js");
  }

  it("keeps a reply's text, mentions and images across a reload", async () => {
    const states = mount([{ key: "reply:t1" }]);
    act(() => {
      states[0]!.setText("Looks off @Bob");
      states[0]!.setMentions([{ label: "Bob", email: "bob@example.com" }]);
      states[0]!.setImages([image]);
    });
    expect(states[0]!.draft.text).toBe("Looks off @Bob");
    expect(Object.keys(stored()!.drafts)).toEqual(["reply:t1"]);

    await reload();
    const after = mount([{ key: "reply:t1" }]);
    expect(after[0]!.saved).toBe(true);
    expect(after[0]!.draft).toEqual({
      text: "Looks off @Bob",
      mentions: [{ label: "Bob", email: "bob@example.com" }],
      images: [image],
    });
  });

  it("keeps each thread's draft apart, and one thread's in step across its boxes", () => {
    const states = mount([
      { key: "reply:t1" },
      { key: "reply:t1" },
      { key: "reply:t2" },
    ]);
    act(() => states[0]!.setText("First"));
    expect(states[1]!.draft.text).toBe("First");
    expect(states[2]!.draft.text).toBe("");
    act(() => states[2]!.setText("Second"));
    expect(states[0]!.draft.text).toBe("First");
  });

  it("forgets a draft that's cleared, emptied, or back to the comment it edits", () => {
    const initial = { text: "Original", mentions: [], images: [image] };
    const states = mount([{ key: "reply:t1" }, { key: "edit:c1", initial }]);
    expect(states[1]!.draft).toEqual(initial);
    expect(states[1]!.saved).toBe(false);

    act(() => {
      states[0]!.setText("Draft");
      states[1]!.setText("Edited");
    });
    expect(Object.keys(stored()!.drafts).sort()).toEqual([
      "edit:c1",
      "reply:t1",
    ]);

    act(() => {
      states[0]!.setText("   ");
      states[1]!.setText("Original");
    });
    expect(stored()).toBeNull();
    expect(states[1]!.draft).toEqual(initial);

    act(() => states[0]!.setText("Again"));
    act(() => states[0]!.clear());
    expect(states[0]!.draft.text).toBe("");
    expect(stored()).toBeNull();
  });

  it("drops an edit's draft once the comment it started from changes", async () => {
    const initial = { text: "Original", mentions: [], images: [] };
    const states = mount([{ key: "edit:c1", initial }]);
    act(() => states[0]!.setText("Edited"));

    await reload();
    const same = mount([{ key: "edit:c1", initial: { ...initial } }]);
    expect(same[0]!.saved).toBe(true);
    expect(same[0]!.draft.text).toBe("Edited");

    await reload();
    const changed = { ...initial, text: "Changed in another tab" };
    const after = mount([{ key: "edit:c1", initial: changed }]);
    expect(after[0]!.saved).toBe(false);
    expect(after[0]!.draft).toEqual(changed);
    expect(stored()).toBeNull();
  });

  it("leaves a thread's draft be when an earlier thread's send finishes after the box moved to it", () => {
    let state!: DraftsModule.ReviewCommentDraftState;
    function ReplyBox({ threadId }: { threadId: string }) {
      state = drafts.useReviewCommentDraft(scope, `reply:${threadId}`);
      return null;
    }
    act(() => root.render(<ReplyBox threadId="t1" />));
    act(() => state.setText("For the first"));
    const sentClear = state.clear;
    act(() => root.render(<ReplyBox threadId="t2" />));
    act(() => state.setText("For the second"));

    act(() => {
      sentClear();
      state.setImages([image]);
    });
    expect(state.draft).toEqual({
      text: "For the second",
      mentions: [],
      images: [image],
    });
    expect(Object.keys(stored()!.drafts)).toEqual(["reply:t2"]);
  });

  it("keeps an image-only draft, and context the app stores with it", () => {
    const states = mount([{ key: "new:screen-1" }]);
    act(() =>
      states[0]!.update({
        images: [image],
        context: { pin: { id: "pin-1" } },
      }),
    );
    expect(stored()!.drafts["new:screen-1"]).toMatchObject({
      text: "",
      images: [image],
      context: { pin: { id: "pin-1" } },
    });
  });

  it("keeps a signed-out draft in memory only", () => {
    const signedOut = { ...scope, userEmail: null };
    const states = mount([{ key: "reply:t1", scope: signedOut }]);
    act(() => states[0]!.setText("Not stored"));
    expect(states[0]!.draft.text).toBe("Not stored");
    expect(window.localStorage.length).toBe(0);
  });

  it("reads storage afresh once no box is open on the resource", () => {
    const signedOut = { ...scope, userEmail: null };
    const states = mount([
      { key: "reply:t1" },
      { key: "reply:t1", scope: signedOut },
    ]);
    act(() => {
      states[0]!.setText("Stored");
      states[1]!.setText("Not stored");
    });
    act(() => root.render(null));
    window.localStorage.clear();

    const after = mount([
      { key: "reply:t1" },
      { key: "reply:t1", scope: signedOut },
    ]);
    expect(after[0]!.draft.text).toBe("");
    expect(after[1]!.draft.text).toBe("");
  });

  it("has no draft without a key or a scope", () => {
    const states = mount([{ key: null }, { key: "reply:t1", scope: null }]);
    act(() => {
      states[0]!.setText("Lost");
      states[1]!.setText("Lost");
    });
    expect(states[0]!.draft.text).toBe("");
    expect(states[1]!.draft.text).toBe("");
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps a person's drafts for each account apart", () => {
    const personal = drafts.reviewCommentDraftStorageKey(scope);
    const org = drafts.reviewCommentDraftStorageKey({ ...scope, orgId: "o1" });
    expect(personal).toContain('"email":"alice@example.com"');
    expect(org).not.toBe(personal);
    expect(
      drafts.reviewCommentDraftStorageKey({ ...scope, userEmail: " " }),
    ).toBeNull();
  });

  it("keeps the newest fifty drafts", () => {
    const keys = Array.from({ length: 52 }, (_, index) => `reply:t${index}`);
    const states = mount(keys.map((key) => ({ key })));
    let now = 1_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 1));
    act(() =>
      states.forEach((state, index) => state.setText(`Draft ${index}`)),
    );
    clock.mockRestore();
    const kept = Object.keys(stored()!.drafts);
    expect(kept).toHaveLength(50);
    expect(kept).not.toContain("reply:t0");
    expect(kept).not.toContain("reply:t1");
    expect(kept).toContain("reply:t51");
  });

  it("starts fresh from a stored record it can't read, and skips bad drafts", async () => {
    const key = drafts.reviewCommentDraftStorageKey(scope)!;
    window.localStorage.setItem(key, "{");
    expect(mount([{ key: "reply:t1" }])[0]!.draft.text).toBe("");

    await reload();
    window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        drafts: {
          "reply:t1": { text: 42 },
          "reply:t2": {
            text: "Kept",
            mentions: [{ label: "" }, { label: "Bob" }],
            images: [{ url: "" }, { url: image.url }],
          },
        },
      }),
    );
    const states = mount([{ key: "reply:t1" }, { key: "reply:t2" }]);
    expect(states[0]!.saved).toBe(false);
    expect(states[1]!.draft).toEqual({
      text: "Kept",
      mentions: [{ label: "Bob" }],
      images: [{ url: image.url, name: "image" }],
    });
  });

  it("follows another tab's change to the same drafts", () => {
    const states = mount([{ key: "reply:t1" }]);
    act(() => states[0]!.setText("Here"));
    const key = drafts.reviewCommentDraftStorageKey(scope)!;
    const record = stored()!;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        ...record,
        drafts: {
          "reply:t1": { text: "From the other tab", mentions: [], images: [] },
        },
      }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(states[0]!.draft.text).toBe("From the other tab");
  });
});
