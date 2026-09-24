import { contentSuggestionPath } from "@shared/suggestion-link";
// @vitest-environment happy-dom
import { act, useState, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { ReviewCommentMenu, ReviewReactionList } from "./ReviewDiscussionTools";

const mocks = vi.hoisted(() => ({
  react: vi.fn(),
  unread: vi.fn(),
  mute: vi.fn(),
  copy: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  portal: false,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => `/content${path}`,
}));
vi.mock("@agent-native/core/client/clipboard", () => ({
  writeClipboardText: mocks.copy,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: (error: Error) => error.message,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/review", () => ({
  useReactToReviewComment: () => ({ mutate: mocks.react, isPending: false }),
  useSetReviewThreadUnread: () => ({ mutate: mocks.unread, isPending: false }),
  useSetReviewThreadMuted: () => ({ mutate: mocks.mute, isPending: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: Wrapper,
    DropdownMenuTrigger: Wrapper,
    DropdownMenuContent: ({
      children,
      ...props
    }: HTMLAttributes<HTMLDivElement>) => {
      const content = <div {...props}>{children}</div>;
      return mocks.portal ? createPortal(content, document.body) : content;
    },
    DropdownMenuGroup: Wrapper,
    DropdownMenuLabel: Wrapper,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({
      children,
      onSelect,
    }: {
      children: ReactNode;
      onSelect: () => void;
    }) => <button onClick={onSelect}>{children}</button>,
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      onCheckedChange,
    }: {
      children: ReactNode;
      checked: boolean;
      onCheckedChange: (checked: boolean) => void;
    }) => (
      <button aria-pressed={checked} onClick={() => onCheckedChange(!checked)}>
        {children}
      </button>
    ),
  };
});
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const containers: {
  node: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}[] = [];
async function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  containers.push({ node: container, root });
  await act(async () => root.render(node));
  return { container, root };
}
afterEach(async () => {
  for (const { node, root } of containers.splice(0)) {
    await act(async () => root.unmount());
    node.remove();
  }
  vi.clearAllMocks();
  mocks.portal = false;
});
const props = {
  documentId: "doc/one",
  suggestionId: "suggestion?two",
  threadId: "thread-real",
  commentId: "reply-real",
  discussion: {
    reactions: {
      "reply-real": [{ reaction: "👍", count: 2, reactedByMe: true }],
    },
    threadPreferences: { "thread-real": { muted: false, unread: false } },
    canReact: true,
    canSetThreadPreferences: true,
  },
};
function button(container: HTMLElement, text: string) {
  const found = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === text,
  );
  expect(found).toBeDefined();
  return found!;
}
it("targets actual comment and thread identities and reflects preference readback", async () => {
  const { container, root } = await render(<ReviewCommentMenu {...props} />);
  await act(async () => button(container, "👍").click());
  expect(mocks.react).toHaveBeenCalledWith(
    {
      resourceType: "document",
      resourceId: "doc/one",
      commentId: "reply-real",
      reaction: "👍",
      active: false,
    },
    expect.any(Object),
  );
  await act(async () => button(container, "comments.markUnread").click());
  expect(mocks.unread).toHaveBeenCalledWith(
    {
      resourceType: "document",
      resourceId: "doc/one",
      threadId: "thread-real",
      unread: true,
    },
    expect.any(Object),
  );
  await act(async () => button(container, "comments.mute").click());
  expect(mocks.mute).toHaveBeenCalledWith(
    {
      resourceType: "document",
      resourceId: "doc/one",
      threadId: "thread-real",
      muted: true,
    },
    expect.any(Object),
  );
  await act(async () =>
    root.render(
      <ReviewCommentMenu
        {...props}
        discussion={{
          ...props.discussion,
          threadPreferences: { "thread-real": { muted: true, unread: true } },
        }}
      />,
    ),
  );
  expect(container.textContent).toContain("comments.markRead");
  expect(container.textContent).toContain("comments.unmute");
});
it("keeps copy-link available without mutation rights and reports clipboard failures", async () => {
  const { container } = await render(
    <ReviewCommentMenu
      {...props}
      discussion={{
        ...props.discussion,
        canReact: false,
        canSetThreadPreferences: false,
      }}
    />,
  );
  expect(container.textContent).not.toContain("comments.mute");
  expect(container.textContent).not.toContain("comments.addReaction");
  mocks.copy.mockResolvedValueOnce(true);
  await act(async () => button(container, "comments.copyLink").click());
  expect(mocks.copy).toHaveBeenCalledWith(
    new URL(
      "/content/page/doc%2Fone?suggestion=suggestion%3Ftwo",
      window.location.origin,
    ).href,
  );
  expect(mocks.success).toHaveBeenCalledWith("comments.linkCopied");
  mocks.copy.mockResolvedValueOnce(false);
  await act(async () => button(container, "comments.copyLink").click());
  expect(mocks.error).toHaveBeenCalledWith("comments.copyLinkFailed");
});
it("renders reaction counts, toggles membership, and disables viewer mutations", async () => {
  const { container, root } = await render(
    <ReviewReactionList
      documentId="doc/one"
      commentId="reply-real"
      reactions={props.discussion.reactions["reply-real"]}
      canReact
    />,
  );
  expect(button(container, "👍 2").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button(container, "👍 2").click());
  expect(mocks.react).toHaveBeenCalledWith(
    expect.objectContaining({ commentId: "reply-real", active: false }),
    expect.any(Object),
  );
  await act(async () =>
    root.render(
      <ReviewReactionList
        documentId="doc/one"
        commentId="reply-real"
        reactions={[{ reaction: "👍", count: 1, reactedByMe: false }]}
        canReact={false}
      />,
    ),
  );
  expect(button(container, "👍 1").disabled).toBe(true);
  expect(button(container, "👍 1").getAttribute("aria-pressed")).toBe("false");
});
it("encodes document and suggestion IDs for the same server and client link", () => {
  expect(contentSuggestionPath("doc/one", "suggestion?two")).toBe(
    "/page/doc%2Fone?suggestion=suggestion%3Ftwo",
  );
});

it("keeps compact menu triggers visible and desktop triggers available to hover, focus, and touch", async () => {
  const { container, root } = await render(
    <ReviewCommentMenu {...props} alwaysVisible />,
  );
  const trigger = () =>
    container.querySelector('[aria-label="comments.moreActions"]')!;
  expect(trigger().className).not.toContain("md:opacity-0");
  await act(async () => root.render(<ReviewCommentMenu {...props} />));
  expect(trigger().className).toContain("md:opacity-0");
  expect(trigger().className).toContain("[@media(hover:none)]:opacity-100");
  expect(trigger().className).toContain("focus-visible:opacity-100");
});

it.each(["desktop", "compact"])(
  "preserves %s comment context through portal clicks but dismisses outside it",
  async (layout) => {
    mocks.portal = true;
    mocks.copy.mockResolvedValue(true);
    const captured = vi.fn();
    function Harness() {
      const [expanded, setExpanded] = useState(true);
      const [sheetOpen, setSheetOpen] = useState(true);
      return (
        <div
          onClickCapture={(event) => {
            captured();
            if (
              (event.target as HTMLElement).closest(
                "[data-comments-sidebar], [data-comments-history], [data-document-utility-panel]",
              )
            )
              return;
            setExpanded(false);
            if (layout === "compact") setSheetOpen(false);
          }}
        >
          <div data-comments-history data-sheet-open={sheetOpen}>
            <span data-expanded={expanded} />
            <ReviewCommentMenu {...props} />
          </div>
          <button>Outside comments</button>
        </div>
      );
    }
    const { container } = await render(<Harness />);
    const portalButton = button(document.body, "comments.mute");
    expect(container.contains(portalButton)).toBe(false);
    for (const text of [
      "comments.mute",
      "comments.markUnread",
      "👍",
      "comments.copyLink",
    ]) {
      await act(async () => button(document.body, text).click());
      expect(
        container
          .querySelector("[data-expanded]")
          ?.getAttribute("data-expanded"),
      ).toBe("true");
      expect(
        container
          .querySelector("[data-sheet-open]")
          ?.getAttribute("data-sheet-open"),
      ).toBe("true");
    }
    expect(captured).toHaveBeenCalledTimes(4);
    expect(mocks.mute).toHaveBeenCalledTimes(1);
    expect(mocks.unread).toHaveBeenCalledTimes(1);
    expect(mocks.react).toHaveBeenCalledTimes(1);
    expect(mocks.copy).toHaveBeenCalledTimes(1);
    await act(async () => button(container, "Outside comments").click());
    expect(
      container.querySelector("[data-expanded]")?.getAttribute("data-expanded"),
    ).toBe("false");
    expect(
      container
        .querySelector("[data-sheet-open]")
        ?.getAttribute("data-sheet-open"),
    ).toBe(layout === "compact" ? "false" : "true");
  },
);
