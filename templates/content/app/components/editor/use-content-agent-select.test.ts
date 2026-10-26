// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import type { Comment, CommentThread } from "@/hooks/use-comments";

import {
  contentBlockForTarget,
  contentBlockSelectable,
  contentEditorFieldId,
} from "./use-content-agent-select";

function thread(
  threadId: string,
  comments: Array<Pick<Comment, "author_name" | "author_email" | "content">>,
  options: { resolved?: boolean; quotedText?: string } = {},
): CommentThread {
  return {
    threadId,
    quotedText: options.quotedText ?? null,
    prefix: null,
    suffix: null,
    startOffset: null,
    resolved: options.resolved ?? false,
    comments: comments as Comment[],
  };
}

function query<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function renderPage() {
  document.body.innerHTML = `
    <div role="tabpanel" data-block-field-panel data-block-field-id="body-prop" data-primary-block-field-panel>
      <div class="content-editor">
        <h2>Plan</h2>
        <p>Ship it <span class="comment-highlight" data-comment-thread="t1">Friday</span> and <span class="comment-highlight" data-comment-thread="t2">tell</span> sales</p>
        <p>Other block</p>
      </div>
    </div>
    <div role="tabpanel" data-block-field-panel data-block-field-id="notes">
      <div class="content-editor"><p>Notes tab</p></div>
    </div>`;
}

const threads = [
  thread(
    "t1",
    [
      {
        author_name: "Ana",
        author_email: "ana@example.com",
        content: "Too soon?",
      },
      { author_name: "Ben", author_email: "ben@example.com", content: "Fine" },
    ],
    { quotedText: "Friday" },
  ),
  thread(
    "t2",
    [{ author_name: null, author_email: "cy@example.com", content: "Done" }],
    { resolved: true },
  ),
  thread("t3", [
    { author_name: "Di", author_email: "di@example.com", content: "Elsewhere" },
  ]),
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Content Select adapter", () => {
  it("picks the top-level block a target sits in", () => {
    renderPage();
    const found = contentBlockForTarget(query('[data-comment-thread="t1"]'));
    expect(found?.block.tagName).toBe("P");
    expect(found?.block.textContent).toContain("Ship it");
    expect(contentBlockForTarget(query(".content-editor"))).toBeNull();
  });

  it("picks one bullet, not the whole list", () => {
    document.body.innerHTML = `
      <div class="content-editor">
        <ul>
          <li><p>First</p></li>
          <li><p>Second <span data-comment-thread="t1">point</span></p></li>
        </ul>
      </div>`;
    const selectable = contentBlockSelectable(
      "doc-1",
      () => threads,
      query('[data-comment-thread="t1"]'),
    );
    expect(selectable).toMatchObject({
      id: "doc-1/body/ul:nth-child(1) > li:nth-child(2)",
      title: "Second point",
    });
    expect(selectable?.getContext()).toContain("Block type: li");
    expect(selectable?.getContext()).toContain("- thread t1 by Ana");
  });

  it("carries the block's text and its open comment threads", () => {
    renderPage();
    const selectable = contentBlockSelectable(
      "doc-1",
      () => threads,
      query('[data-comment-thread="t1"]'),
    );

    expect(selectable).toMatchObject({
      kind: "block",
      id: "doc-1/body/p:nth-child(2)",
      parent: { kind: "page", id: "doc-1" },
      title: "Ship it Friday and tell sales",
    });
    const context = selectable?.getContext() ?? "";
    expect(context).toContain("Page id: doc-1");
    expect(context).toContain("Block text: Ship it Friday and tell sales");
    expect(context).toContain(
      '- thread t1 by Ana on "Friday": "Too soon?" (1 reply)',
    );
    // Resolved threads and threads on other blocks stay out.
    expect(context).not.toContain("t2");
    expect(context).not.toContain("t3");
  });

  it("names the Blocks field tab a block is in", () => {
    renderPage();
    expect(
      contentEditorFieldId(
        query('[data-block-field-id="notes"] .content-editor'),
      ),
    ).toBe("notes");
    const selectable = contentBlockSelectable(
      "doc-1",
      () => threads,
      query('[data-block-field-id="notes"] p'),
    );
    expect(selectable?.id).toBe("doc-1/notes/p:nth-child(1)");
    expect(selectable?.getContext()).toContain("Blocks field id: notes");
  });

  it("finds the block again after the editor re-renders, and loses it once deleted", () => {
    renderPage();
    const selectable = contentBlockSelectable(
      "doc-1",
      () => threads,
      query('[data-comment-thread="t1"]'),
    );
    const editor = query(".content-editor");
    editor.innerHTML = editor.innerHTML;
    expect((selectable?.getElement() as Element | null)?.textContent).toContain(
      "Ship it",
    );

    query('[data-comment-thread="t1"]').closest("p")?.remove();
    expect(selectable?.getElement()).toBeNull();
  });
});
