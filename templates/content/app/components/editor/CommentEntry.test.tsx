// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Comment } from "@/hooks/use-comments";

import { CommentDraftProvider, useCommentDraft } from "./comment-drafts";
import { CommentEntry } from "./CommentEntry";

const { reconcile, mutateAsync } = vi.hoisted(() => ({
  reconcile: vi.fn(),
  mutateAsync: vi.fn(),
}));
vi.mock("@/hooks/use-comments", () => ({
  useCreateComment: () => ({ reconcileAmbiguous: reconcile }),
  useEditComment: () => ({ isPending: false, mutateAsync }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useAvatarUrl: () => null,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: () => "Sep 10" }),
}));
vi.mock("@agent-native/core/client/markdown", () => ({
  InlineMarkdown: ({ content }: { content: string }) => <>{content}</>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
}));
vi.mock("./CommentComposer", () => ({
  CommentComposer: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const comment: Comment = {
  id: "comment-1",
  document_id: "doc-1",
  thread_id: "comment-1",
  parent_id: null,
  content: "Original comment",
  quoted_text: null,
  anchor_prefix: null,
  anchor_suffix: null,
  anchor_start_offset: null,
  mentions: [],
  author_email: "author@example.test",
  author_name: "Author",
  resolved: 0,
  created_at: "2026-09-10T12:00:00Z",
  updated_at: "2026-09-10T12:00:00Z",
  notion_comment_id: null,
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let sourceDraft: ReturnType<typeof useCommentDraft>;
let editDraft: ReturnType<typeof useCommentDraft>;

function DraftProbe() {
  sourceDraft = useCommentDraft("pending");
  editDraft = useCommentDraft("edit:comment-1", {
    text: comment.content,
    mentions: [],
  });
  return null;
}
function Harness({
  visible = true,
  entry = comment,
}: {
  visible?: boolean;
  entry?: Comment;
}) {
  return (
    <CommentDraftProvider
      documentId="doc-1"
      currentUserEmail={comment.author_email}
    >
      <DraftProbe />
      {visible && (
        <CommentEntry
          comment={entry}
          documentId="doc-1"
          currentUserEmail={comment.author_email}
          canComment
          members={[]}
        />
      )}
    </CommentDraftProvider>
  );
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.clearAllMocks();
  reconcile.mockResolvedValue("confirmed");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

it("keeps an edit draft when its row unmounts and reopens", async () => {
  await act(async () => root.render(<Harness />));
  await click("comments.edit");
  await act(async () => editDraft.setText("Unfinished revision"));
  expect(container.querySelector("textarea")?.value).toBe(
    "Unfinished revision",
  );
  await act(async () => root.render(<Harness visible={false} />));
  await act(async () => root.render(<Harness />));
  await click("comments.edit");
  expect(container.querySelector("textarea")?.value).toBe(
    "Unfinished revision",
  );
  await click("comments.cancel");
  await click("comments.edit");
  expect(container.querySelector("textarea")?.value).toBe(comment.content);
});

it.each([false, true])(
  "checks a submitted operation after remount without clearing newer text (%s)",
  async (newerDraft) => {
    const entry: Comment = {
      ...comment,
      mutation: {
        operationId: "operation-1",
        kind: "create",
        status: "error",
        ambiguous: true,
      },
    };
    await act(async () => root.render(<Harness entry={entry} />));
    await act(async () => sourceDraft.setText("Submitted comment"));
    sourceDraft.markSubmitted("operation-1");
    if (newerDraft)
      await act(async () => sourceDraft.setText("Newer unsent comment"));
    await act(async () =>
      root.render(<Harness visible={false} entry={entry} />),
    );
    await act(async () => root.render(<Harness entry={entry} />));
    await click("comments.checkSaved");
    expect(reconcile).toHaveBeenCalledWith("doc-1", "operation-1");
    expect(sourceDraft.draft.text).toBe(
      newerDraft ? "Newer unsent comment" : "",
    );
  },
);

it("keeps the submitted draft when checking remains unresolved", async () => {
  reconcile.mockResolvedValue("unresolved");
  const entry: Comment = {
    ...comment,
    mutation: {
      operationId: "operation-1",
      kind: "create",
      status: "error",
      ambiguous: true,
    },
  };
  await act(async () => root.render(<Harness entry={entry} />));
  await act(async () => sourceDraft.setText("Submitted comment"));
  sourceDraft.markSubmitted("operation-1");
  await click("comments.checkSaved");
  expect(sourceDraft.draft.text).toBe("Submitted comment");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "comments.saveUnconfirmed",
  );
});
