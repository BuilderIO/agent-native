import { snapshotComposerContextItems } from "@agent-native/core/client/composer";
// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomePromptContext } from "./HomePromptContext";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  query: vi.fn(),
  retry: vi.fn(),
  select: vi.fn(),
  session: { email: "user@example.com", orgId: "org-one" },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: mocks.session }),
  callAction: (...args: unknown[]) => mocks.call(...args),
  useActionQuery: (...args: unknown[]) => mocks.query(...args),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error
      ? error.message.replace(/^Action failed: /, "")
      : undefined,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/composer", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  ComposerContextSearchInput: ({
    value,
    onValueChange,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onInput={(event) => onValueChange?.(event.currentTarget.value)}
    />
  ),
}));
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandEmpty: ({ children }: { children: ReactNode }) => (
    <div data-empty>{children}</div>
  ),
  CommandItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children: ReactNode;
    onSelect: () => void;
    disabled?: boolean;
  }) => (
    <button data-option disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));
type Props = Parameters<typeof useHomePromptContext>[0];
let controller: ReturnType<typeof useHomePromptContext>;
let root: Root;
let container: HTMLDivElement;
let props: Props;
const controls = { onBack: vi.fn(), onClose: vi.fn(), onResume: vi.fn() };
function Harness({ page }: { page?: string }) {
  controller = useHomePromptContext(props);
  const item = controller.menuItems
    .flatMap((item) => item.children ?? [item])
    .find((item) => item.id === page);
  return (
    <>
      {item && "render" in item ? item.render?.(controls) : null}
      <output>{JSON.stringify(controller.contextItems)}</output>
    </>
  );
}
async function render(page?: string) {
  await act(async () => root.render(<Harness page={page} />));
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { email: "user@example.com", orgId: "org-one" };
  mocks.call.mockResolvedValue({
    id: "ref",
    title: "Reference",
    context: "Bounded visual context",
  });
  mocks.query.mockReturnValue({
    data: { items: [{ id: "ref", title: "Reference" }], hasMore: false },
    isSuccess: true,
    refetch: mocks.retry,
  });
  props = {
    systems: [],
    systemId: null,
    onSystemChange: mocks.select,
    templates: [],
    templateId: null,
    onTemplateChange: mocks.select,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("home prompt context", () => {
  it("nests only the supported design sources in the agreed order", async () => {
    await render();
    expect(controller.menuItems.map((item) => item.id)).toEqual(["design"]);
    expect(controller.menuItems[0]).toMatchObject({
      searchPlaceholder: "homeContext.searchDesign",
    });
    expect(
      controller.menuItems[0].children?.map(({ id, label }) => ({ id, label })),
    ).toEqual([
      { id: "system", label: "homeContext.useDesignSystem" },
      { id: "figma-reference", label: "homeContext.figmaReference" },
      { id: "design-reference", label: "homeContext.referenceDesign" },
      { id: "slides-reference", label: "homeContext.referenceDeck" },
    ]);
  });
  it.each([
    ["system", "homeContext.searchSystems"],
    ["figma-reference", "homeContext.searchFrames"],
    ["design-reference", "homeContext.searchDesigns"],
    ["slides-reference", "homeContext.searchPresentations"],
  ])("gives %s search a localized accessible purpose", async (page, label) => {
    await render(page);
    const input = container.querySelector("input")!;
    expect(input.getAttribute("aria-label")).toBe(label);
    expect(input.placeholder).toBe(label);
  });
  it("clears selected context on identity change and rejects old in-flight reads", async () => {
    const old = deferred<unknown>();
    mocks.call.mockReturnValueOnce(old.promise);
    await render("design-reference");
    await click("Reference");
    mocks.session = { email: "other@example.com", orgId: "org-two" };
    await render("design-reference");
    expect(controller.contextItems).toEqual([]);
    expect(mocks.select).toHaveBeenCalledWith(null);
    await act(async () =>
      old.resolve({ id: "ref", title: "Private", context: "Old account data" }),
    );
    expect(controller.contextItems).toEqual([]);
  });
  it("revalidates access before submission and freezes the newly read context", async () => {
    await render("design-reference");
    await click("Reference");
    const original = snapshotComposerContextItems(controller.contextItems);
    mocks.call.mockResolvedValueOnce({
      id: "ref",
      title: "Reference",
      context: "Fresh authorized context",
    });
    const fresh = await controller.prepareSubmission(original);
    expect(fresh?.[0].context).toBe("Fresh authorized context");
    expect(original?.[0].context).toBe("Bounded visual context");
    expect(Object.isFrozen(fresh)).toBe(true);
    mocks.call.mockRejectedValueOnce(
      new Error("Action failed: Access revoked"),
    );
    await act(async () => {
      await expect(controller.prepareSubmission(fresh)).rejects.toThrow(
        "Access revoked",
      );
    });
    expect(controller.contextItems[0]).toMatchObject({
      status: "error",
      context: "",
      statusMessage: "Access revoked",
    });
  });
  it("captures selected source and system ids before asynchronous validation, never adopting a later selection", async () => {
    mocks.call.mockResolvedValueOnce({ agentContext: "System A" });
    props = {
      ...props,
      systemId: "a",
      systems: [{ id: "a", title: "A", ready: true }],
    };
    await render();
    const read = deferred<unknown>();
    mocks.call.mockReturnValueOnce(read.promise);
    const submitted = controller.prepareSubmission(
      snapshotComposerContextItems(controller.contextItems),
    );
    props = { ...props, systemId: null };
    await render();
    await act(async () => read.resolve({ agentContext: "Validated A" }));
    expect((await submitted)?.[0].context).toBe("Validated A");
    expect(controller.contextItems).toEqual([]);
  });
  it("blocks a pending submission across an org switch and accepts metadata-only templates", async () => {
    props = {
      ...props,
      templateId: "tpl",
      templates: [{ id: "tpl", title: "Template", isBuiltIn: true }],
    };
    await render("design-reference");
    const metadata = await controller.prepareSubmission(
      snapshotComposerContextItems(controller.contextItems),
    );
    expect(metadata?.[0].context).toBe("");
    expect(mocks.call).not.toHaveBeenCalled();
    await click("Reference");
    const read = deferred<unknown>();
    mocks.call.mockReturnValueOnce(read.promise);
    const submission = controller.prepareSubmission(
      snapshotComposerContextItems(controller.contextItems),
    );
    const rejection = expect(submission).rejects.toThrow(
      "homeContext.loadFailed",
    );
    mocks.session = { email: "user@example.com", orgId: "different-org" };
    props = { ...props, templateId: null };
    await render();
    await act(async () =>
      read.resolve({ id: "ref", title: "Reference", context: "Old org" }),
    );
    await rejection;
  });
  it("resolves local and peer references with source-owned typed reads", async () => {
    await render("design-reference");
    await click("Reference");
    expect(mocks.call).toHaveBeenCalledWith(
      "read-composer-source",
      { source: "design", operation: "read", id: "ref", page: 1 },
      { method: "GET" },
    );
    await render("slides-reference");
    await click("Reference");
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      { source: "slides", operation: "read", id: "ref", page: 1 },
      { method: "GET" },
    );
    expect(controller.contextItems).toHaveLength(2);
    expect(
      controller.contextItems.every((item) => item.status === "ready"),
    ).toBe(true);
  });
  it("blocks pending/error context, shows clean failures, and retries without losing selection", async () => {
    const request = deferred<unknown>();
    mocks.call.mockReturnValueOnce(request.promise);
    await render("design-reference");
    await click("Reference");
    expect(() =>
      snapshotComposerContextItems(controller.contextItems),
    ).toThrow();
    await act(async () =>
      request.reject(new Error("Action failed: Reference access denied")),
    );
    expect(controller.contextItems[0]).toMatchObject({
      status: "error",
      statusMessage: "Reference access denied",
    });
    expect(() =>
      snapshotComposerContextItems(controller.contextItems),
    ).toThrow();
    await act(async () => controller.retry(controller.contextItems[0].key));
    const snapshot = snapshotComposerContextItems(controller.contextItems);
    await act(async () => controller.remove(controller.contextItems[0].key));
    expect(controller.contextItems).toHaveLength(0);
    expect(snapshot[0].context).toBe("Bounded visual context");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
  it("does not resurrect removed references or overwrite a re-added reference with an old response", async () => {
    const old = deferred<unknown>();
    const next = deferred<unknown>();
    mocks.call
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    await render("design-reference");
    await click("Reference");
    await act(async () => controller.remove(controller.contextItems[0].key));
    await click("Reference");
    await act(async () =>
      old.resolve({ id: "ref", title: "Old", context: "old" }),
    );
    expect(controller.contextItems[0].status).toBe("pending");
    await act(async () =>
      next.resolve({ id: "ref", title: "New", context: "new" }),
    );
    expect(controller.contextItems[0]).toMatchObject({
      title: "New",
      context: "new",
      status: "ready",
    });
  });
  it("uses nextCursor history for Slides and clears it on search or source change", async () => {
    mocks.query.mockImplementation((_name, params) => ({
      data: {
        items: [],
        hasMore: true,
        nextCursor: params.cursor ? "cursor-3" : "cursor-2",
      },
      isSuccess: true,
    }));
    await render("slides-reference");
    await click("home.paginationNext");
    expect(mocks.query.mock.lastCall?.[1]).toMatchObject({
      source: "slides",
      page: 2,
      cursor: "cursor-2",
    });
    await click("home.paginationNext");
    expect(mocks.query.mock.lastCall?.[1].cursor).toBe("cursor-3");
    await click("home.paginationPrevious");
    expect(mocks.query.mock.lastCall?.[1].cursor).toBe("cursor-2");
    const search = container.querySelector("input")!;
    await act(async () => {
      search.value = "campaign";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mocks.query.mock.lastCall?.[1]).toMatchObject({
      page: 1,
      cursor: undefined,
      search: "campaign",
    });
    await click("home.paginationNext");
    await render("design-reference");
    expect(mocks.query.mock.lastCall?.[1]).toMatchObject({
      source: "design",
      page: 1,
      cursor: undefined,
      search: "",
    });
  });
  it("shows query failure and retry instead of claiming the list is empty", async () => {
    mocks.query.mockReturnValue({
      isError: true,
      error: new Error("Action failed: Peer unavailable"),
      refetch: mocks.retry,
    });
    await render("slides-reference");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Peer unavailable",
    );
    expect(container.textContent).not.toContain("homeContext.empty");
    await click("homeContext.retry");
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
  it("marks the selected system and shows loading/error/empty selection states", async () => {
    props = {
      ...props,
      systemId: "system",
      systems: [{ id: "system", title: "Chosen", ready: true }],
    };
    await render("system");
    expect(
      Array.from(container.querySelectorAll("button"))
        .find((item) => item.textContent === "Chosen")
        ?.querySelector("svg"),
    ).toBeTruthy();
    props = { ...props, systems: [], systemsLoading: true };
    await render("system");
    expect(container.querySelector("[data-empty]")).toBeNull();
    props = {
      ...props,
      systemsLoading: false,
      systemsError: new Error("Action failed: Catalog failed"),
      retrySystems: mocks.retry,
    };
    await render("system");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Catalog failed",
    );
    await click("homeContext.retry");
    expect(mocks.retry).toHaveBeenCalledOnce();
    props = { ...props, systemsError: undefined };
    await render("system");
    expect(container.querySelector("[data-empty]")).toBeTruthy();
  });
  it("binds frozen system context to the selected id rather than the previous render", async () => {
    mocks.call.mockResolvedValueOnce({ agentContext: "System A" });
    props = {
      ...props,
      systemId: "a",
      systems: [
        { id: "a", title: "A", ready: true },
        { id: "b", title: "B", ready: true },
      ],
    };
    await render("system");
    const snapshot = snapshotComposerContextItems(controller.contextItems);
    const next = deferred<unknown>();
    mocks.call.mockReturnValueOnce(next.promise);
    props = { ...props, systemId: "b" };
    await render("system");
    expect(controller.contextItems[0]).toMatchObject({
      title: "B",
      status: "pending",
      context: "",
    });
    await act(async () => next.resolve({ agentContext: "System B" }));
    expect(controller.contextItems[0].context).toBe("System B");
    expect(snapshot[0].context).toBe("System A");
  });
});
