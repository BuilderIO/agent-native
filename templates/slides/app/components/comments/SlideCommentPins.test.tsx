// @vitest-environment happy-dom
import type { ReviewComment } from "@agent-native/core/review";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentThread } from "@/hooks/use-slide-comments";

import { SlideCommentPins } from "./SlideCommentPins";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  reply: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  react: vi.fn(),
  sendToAgent: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : null,
  useSession: () => ({
    session: { email: "writer@example.com", orgId: null },
  }),
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/i18n")>();
  const { default: english } =
    await vi.importActual<typeof import("@/i18n/en-US")>("@/i18n/en-US");
  const lookup = (key: string): unknown =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[part]
            : undefined,
        english,
      );
  return {
    ...actual,
    useT:
      () =>
      (key: string, values: Record<string, unknown> = {}) => {
        const plural =
          typeof values.count === "number"
            ? `_${new Intl.PluralRules("en").select(values.count)}`
            : "";
        const message = lookup(`${key}${plural}`) ?? lookup(key);
        return typeof message === "string"
          ? message.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
              String(values[name]),
            )
          : key;
      },
  };
});

vi.mock("@agent-native/core/client/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/review")
  >()),
  useCreateReviewComment: () => ({
    mutateAsync: mocks.create,
    isPending: false,
  }),
  useReplyReviewComment: () => ({ mutateAsync: mocks.reply, isPending: false }),
  useUpdateReviewComment: () => ({
    mutateAsync: mocks.update,
    isPending: false,
  }),
  useDeleteReviewComment: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
  }),
  useResolveReviewThread: () => ({
    mutateAsync: mocks.resolve,
    isPending: false,
  }),
  useReactToReviewComment: () => ({
    mutateAsync: mocks.react,
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChatAndConfirm: mocks.sendToAgent,
}));

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/toolkit/app/review", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/review")
  >()),
  useReviewMentionPeople: () => ({
    people: [],
    searching: false,
    failed: false,
    onMentionQueryChange: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));

const PopoverContext = createContext<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
} | null>(null);

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    open = false,
    onOpenChange,
  }: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <PopoverContext.Provider value={{ open, onOpenChange }}>
      {children}
    </PopoverContext.Provider>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => {
    const context = useContext(PopoverContext);
    return (
      <span onClick={() => context?.onOpenChange?.(!context.open)}>
        {children}
      </span>
    );
  },
  PopoverContent: ({
    children,
    ...props
  }: { children: ReactNode } & Record<string, unknown>) => {
    const context = useContext(PopoverContext);
    const dataAttributes = Object.fromEntries(
      Object.entries(props).filter(([name]) => name.startsWith("data-")),
    );
    return context?.open ? <div {...dataAttributes}>{children}</div> : null;
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));

vi.mock("@/hooks/use-slide-comments", () => ({
  useSlideComments: () => ({
    data: {
      threads: [],
      discussion: {
        reactions: {},
        threadPreferences: {},
        canReact: true,
        canSetThreadPreferences: true,
      },
    },
    isError: false,
  }),
}));

type EditorElement = HTMLElement & {
  editor: {
    commands: { focus: (position: "end") => boolean };
    state: { tr: { insertText: (text: string) => unknown } };
    view: { dispatch: (transaction: unknown) => void };
  };
};

function comment(
  id: string,
  extra: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    resourceType: "deck",
    resourceId: "deck-1",
    threadId: "thread-1",
    parentCommentId: null,
    targetId: null,
    surfaceId: "slide-1",
    kind: "comment",
    status: "open",
    anchor: { x: 25, y: 30 },
    anchorKind: "slide-point",
    anchorVersion: null,
    body: "Check this image",
    authorEmail: "other@example.com",
    authorName: "Other",
    createdBy: "human",
    resolutionTarget: "human",
    mentions: [],
    metadata: null,
    canDelete: false,
    canDeleteThread: false,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...extra,
  } as ReviewComment;
}

function thread(
  root: ReviewComment,
  extra: Partial<CommentThread> = {},
): CommentThread {
  return {
    threadId: root.threadId,
    slideId: root.surfaceId ?? null,
    quotedText: null,
    anchor: { x: 25, y: 30 },
    resolved: false,
    root,
    replies: [],
    ...extra,
  };
}

function rect(left: number, top: number, width: number, height: number) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
  };
}

function renderWithCanvas(
  props: Partial<ComponentProps<typeof SlideCommentPins>> = {},
) {
  const canvas = document.createElement("div");
  canvas.dataset.mainSlideCanvas = "true";
  canvas.dataset.slideCanvasFocus = "true";
  canvas.tabIndex = 0;
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(100, 50, 400, 200),
  });
  const firstPane = document.createElement("div");
  firstPane.className = "slide-content";
  canvas.append(firstPane);
  document.body.append(canvas);

  return {
    ...render(
      <SlideCommentPins
        active={false}
        canComment
        comments={[]}
        deckId="deck-1"
        slideId="slide-1"
        canvasSelector="[data-main-slide-canvas='true']"
        currentUserEmail="writer@example.com"
        {...props}
      />,
    ),
    canvas,
    firstPane,
  };
}

async function findElement<T extends Element = HTMLElement>(
  selector: string,
): Promise<T> {
  return waitFor(() => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`no element matches ${selector}`);
    return element;
  });
}

async function editorNamed(name: string): Promise<EditorElement> {
  const element = await screen.findByRole("textbox", { name });
  return element as EditorElement;
}

function typeInto(element: EditorElement, text: string) {
  act(() => {
    element.editor.commands.focus("end");
  });
  act(() => {
    const { state, view } = element.editor;
    view.dispatch(state.tr.insertText(text));
  });
}

function pressEnter(element: HTMLElement, init: KeyboardEventInit = {}) {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function placeObject(
  pane: HTMLElement,
  object: HTMLElement,
  text: string,
): HTMLElement {
  object.textContent = text;
  Object.defineProperty(object, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(200, 100, 100, 80),
  });
  pane.append(object);
  const target = document.createElement("span");
  target.textContent = text;
  object.append(target);
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [target, object],
  });
  return object;
}

function deferred<T>() {
  const handlers = {
    resolve: (_value: T) => {},
    reject: (_reason: unknown) => {},
  };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return { promise, resolve: handlers.resolve, reject: handlers.reject };
}

async function dropPinAndSend(text: string) {
  const plane = await findElement("[data-slide-comment-click-plane]");
  fireEvent.click(plane, { clientX: 300, clientY: 150 });
  const editor = await editorNamed("Add comment");
  typeInto(editor, text);
  pressEnter(editor);
}

describe("SlideCommentPins", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.create.mockResolvedValue(comment("comment-1"));
    mocks.sendToAgent.mockResolvedValue({ delivered: true });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document
      .querySelectorAll("[data-main-slide-canvas]")
      .forEach((canvas) => canvas.remove());
    Reflect.deleteProperty(document, "elementsFromPoint");
  });

  it("creates a comment at the clicked slide position", async () => {
    const onBeforeCommentSubmit = vi.fn(async () => {});
    renderWithCanvas({ active: true, onBeforeCommentSubmit });

    await dropPinAndSend("Move this title");

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        resourceType: "deck",
        resourceId: "deck-1",
        surfaceId: "slide-1",
        body: "Move this title",
        mentions: [],
        anchor: { x: 50, y: 50 },
        anchorKind: "slide-point",
      }),
    );
    expect(onBeforeCommentSubmit).toHaveBeenCalledOnce();
    expect(mocks.sendToAgent).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Add comment" })).toBeNull(),
    );
  });

  it("keeps the pending pin comment open while IME keys are composing", async () => {
    renderWithCanvas({ active: true });
    const plane = await findElement("[data-slide-comment-click-plane]");

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    const editor = await editorNamed("Add comment");
    typeInto(editor, "candidate");
    pressEnter(editor, { isComposing: true });

    expect(screen.getByRole("textbox", { name: "Add comment" })).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps a failed pin comment open with its reason", async () => {
    mocks.create.mockRejectedValue(new Error("Slide is gone"));
    renderWithCanvas({ active: true });

    await dropPinAndSend("Move this title");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Slide is gone",
    );
    expect(
      screen.getByRole("textbox", { name: "Add comment" }).textContent,
    ).toContain("Move this title");
  });

  it("persists object-relative coordinates when a component is clicked", async () => {
    const { firstPane } = renderWithCanvas({ active: true });
    const object = document.createElement("div");
    object.dataset.slideObjectId = "chart-1";
    placeObject(firstPane, object, "Revenue chart");

    await dropPinAndSend("Check the chart");

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Check the chart",
          anchor: {
            x: 50,
            y: 50,
            objectId: "chart-1",
            objectX: 100,
            objectY: 62.5,
            targetText: "Revenue chart",
          },
          anchorKind: "slide-point",
        }),
      ),
    );
  });

  it("assigns an id before anchoring a first comment on an unpersisted object", async () => {
    const ensureObjectId = vi.fn(() => "new-object");
    const { firstPane } = renderWithCanvas({
      active: true,
      onEnsureObjectId: ensureObjectId,
    });
    const object = document.createElement("div");
    object.className = "fmd-freeform-object";
    object.style.position = "absolute";
    placeObject(firstPane, object, "New shape");

    await dropPinAndSend("Check this new shape");

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "Check this new shape",
          anchor: {
            x: 50,
            y: 50,
            objectId: "new-object",
            objectX: 100,
            objectY: 62.5,
            targetText: "New shape",
          },
        }),
      ),
    );
    expect(ensureObjectId).toHaveBeenCalledWith(object);
  });

  it("opens and selects the full thread when an avatar marker is clicked", async () => {
    const onSelectThread = vi.fn();
    renderWithCanvas({
      onSelectThread,
      comments: [
        thread(comment("comment-1"), {
          replies: [
            comment("reply-1", {
              parentCommentId: "comment-1",
              body: "Swapped it",
            }),
          ],
        }),
      ],
    });

    const marker = await findElement("[data-slide-comment-marker]");
    expect(marker.textContent).toContain("2");
    fireEvent.click(marker);

    const popover = await findElement("[data-slide-comment-popover]");
    expect(popover.textContent).toContain("Check this image");
    expect(popover.textContent).toContain("Swapped it");
    expect(onSelectThread).toHaveBeenCalledWith("thread-1");
  });

  it("replies and resolves from a marker's thread", async () => {
    mocks.reply.mockResolvedValue(
      comment("reply-1", { parentCommentId: "comment-1" }),
    );
    mocks.resolve.mockResolvedValue({});
    renderWithCanvas({ comments: [thread(comment("comment-1"))] });

    fireEvent.click(await findElement("[data-slide-comment-marker]"));
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const editor = await editorNamed("Reply");
    typeInto(editor, "On it");
    pressEnter(editor);

    await waitFor(() =>
      expect(mocks.reply).toHaveBeenCalledWith({
        resourceType: "deck",
        resourceId: "deck-1",
        commentId: "comment-1",
        body: "On it",
        mentions: [],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull(),
    );
    expect(mocks.sendToAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Resolve thread" }));
    expect(mocks.resolve).toHaveBeenCalledWith({
      resourceType: "deck",
      resourceId: "deck-1",
      threadId: "thread-1",
      status: "resolved",
    });
  });

  it("says why resolving from a marker failed once the marker has gone", async () => {
    const resolving = deferred<unknown>();
    mocks.resolve.mockReturnValue(resolving.promise);
    const view = renderWithCanvas({
      comments: [thread(comment("comment-1"))],
    });

    fireEvent.click(await findElement("[data-slide-comment-marker]"));
    fireEvent.click(screen.getByRole("button", { name: "Resolve thread" }));
    view.rerender(
      <SlideCommentPins
        active={false}
        canComment
        comments={[]}
        deckId="deck-1"
        slideId="slide-1"
        canvasSelector="[data-main-slide-canvas='true']"
        currentUserEmail="writer@example.com"
      />,
    );
    expect(document.querySelector("[data-slide-comment-marker]")).toBeNull();
    await act(async () => {
      resolving.reject(new Error("Resolve failed"));
      await resolving.promise.catch(() => undefined);
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Resolve failed"),
    );
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });

  it("leaves a newer pin open when an earlier pin's send finishes", async () => {
    const creating = deferred<unknown>();
    mocks.create.mockReturnValue(creating.promise);
    renderWithCanvas({ active: true });

    await dropPinAndSend("Move this title");
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    fireEvent.click(await findElement("[data-slide-comment-click-plane]"), {
      clientX: 200,
      clientY: 100,
    });
    await act(async () => {
      creating.resolve(comment("comment-1"));
      await creating.promise;
    });

    expect(screen.getByRole("textbox", { name: "Add comment" })).toBeTruthy();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("names a marker with its comment's words, not its Markdown", async () => {
    renderWithCanvas({
      comments: [
        thread(
          comment("comment-1", {
            body: "**Bigger** title for @[Sam Lee](mailto:sam@example.com)\n\n- and `step-2`",
          }),
        ),
      ],
    });

    const marker = await findElement("[data-slide-comment-marker]");
    expect(marker.getAttribute("aria-label")).toBe(
      "Bigger title for @Sam Lee - and step-2",
    );
  });

  it("positions fallback text highlights relative to the canvas", async () => {
    const getClientRects = vi
      .spyOn(Range.prototype, "getClientRects")
      .mockReturnValue([
        { left: 140, top: 70, width: 80, height: 18 },
      ] as unknown as DOMRectList);
    vi.stubGlobal("CSS", {});

    try {
      const { firstPane } = renderWithCanvas({
        comments: [
          thread(comment("comment-1", { body: "Check this text" }), {
            quotedText: "Anchor text",
          }),
        ],
      });
      firstPane.textContent = "Anchor text";
      fireEvent.resize(window);

      const highlight = await findElement(
        "[data-slide-comment-overlay] [aria-hidden='true'].bg-amber-300\\/40",
      );

      expect(highlight.style.left).toBe("40px");
      expect(highlight.style.top).toBe("20px");
      expect(highlight.style.width).toBe("80px");
      expect(highlight.style.height).toBe("18px");
    } finally {
      getClientRects.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("measures the whole canvas when it contains multiple content panes", async () => {
    const { canvas } = renderWithCanvas({ active: true });
    const secondPane = document.createElement("div");
    secondPane.className = "slide-content";
    canvas.append(secondPane);

    const overlay = await findElement("[data-slide-comment-overlay]");

    expect(overlay.getAttribute("style")).toContain("width: 400px");
    expect(overlay.getAttribute("style")).toContain("height: 200px");
  });

  it("keeps an anchored marker attached as its object moves", async () => {
    let objectRect = rect(200, 100, 100, 80);
    const anchor = {
      x: 10,
      y: 20,
      objectId: "chart-1",
      objectX: 50,
      objectY: 50,
    };
    const view = renderWithCanvas({
      comments: [thread(comment("comment-1", { anchor }), { anchor })],
    });
    const object = document.createElement("div");
    object.dataset.slideObjectId = "chart-1";
    Object.defineProperty(object, "getBoundingClientRect", {
      configurable: true,
      value: () => objectRect,
    });
    view.firstPane.append(object);
    fireEvent.resize(window);

    const markerPosition = () =>
      document
        .querySelector<HTMLElement>("[data-slide-comment-marker]")
        ?.closest<HTMLElement>("[data-slide-comment-marker-position]");
    await waitFor(() => {
      expect(markerPosition()?.style.left).toBe("37.5%");
      expect(markerPosition()?.style.top).toBe("45%");
    });

    objectRect = rect(300, 150, 120, 60);
    fireEvent.resize(window);

    await waitFor(() => {
      expect(markerPosition()?.style.left).toBe("65%");
      expect(markerPosition()?.style.top).toBe("65%");
    });
  });

  it("restores canvas focus after the pin plane is pressed", async () => {
    const { canvas } = renderWithCanvas({ active: true });
    const plane = await findElement("[data-slide-comment-click-plane]");

    fireEvent.pointerDown(plane, { clientX: 300, clientY: 150 });
    expect(document.activeElement).toBe(canvas);
    expect(screen.queryByRole("textbox", { name: "Add comment" })).toBeNull();
  });

  it("keeps a pin's draft to its own spot across a slide change", async () => {
    const pinsOn = (slideId: string) => (
      <SlideCommentPins
        active
        canComment
        comments={[]}
        deckId="deck-1"
        slideId={slideId}
        canvasSelector="[data-main-slide-canvas='true']"
        currentUserEmail="writer@example.com"
      />
    );
    const view = renderWithCanvas({ active: true });
    const plane = await findElement("[data-slide-comment-click-plane]");

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    typeInto(await editorNamed("Add comment"), "Half a thought");

    view.rerender(pinsOn("slide-2"));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Add comment" })).toBeNull(),
    );

    view.rerender(pinsOn("slide-1"));
    fireEvent.click(await findElement("[data-slide-comment-click-plane]"), {
      clientX: 200,
      clientY: 100,
    });
    expect((await editorNamed("Add comment")).textContent).toBe("");

    fireEvent.click(await findElement("[data-slide-comment-click-plane]"), {
      clientX: 300,
      clientY: 150,
    });
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Add comment" }).textContent,
      ).toBe("Half a thought"),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("throws a pin's draft away when its pin is canceled", async () => {
    renderWithCanvas({ active: true });
    const plane = await findElement("[data-slide-comment-click-plane]");

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    typeInto(await editorNamed("Add comment"), "Half a thought");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Add comment" })).toBeNull(),
    );

    fireEvent.click(plane, { clientX: 300, clientY: 150 });
    expect((await editorNamed("Add comment")).textContent).toBe("");
  });

  it("throws a marker reply's draft away on Cancel", async () => {
    renderWithCanvas({ comments: [thread(comment("comment-1"))] });

    fireEvent.click(await findElement("[data-slide-comment-marker]"));
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    typeInto(await editorNamed("Reply"), "Half a reply");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Reply" })).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect((await editorNamed("Reply")).textContent).toBe("");
    expect(mocks.reply).not.toHaveBeenCalled();
  });
});
