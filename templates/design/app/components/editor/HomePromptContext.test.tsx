import { snapshotComposerContextItems } from "@agent-native/core/client/composer";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomePromptContext } from "./HomePromptContext";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  refresh: 0,
  retry: vi.fn(),
  select: vi.fn(),
  session: { email: "user@example.com", orgId: "org-one" },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({ session: mocks.session }),
  callAction: (...args: unknown[]) => mocks.call(...args),
  useChangeVersions: () => mocks.refresh,
  actionErrorMessage: (error: unknown) =>
    error instanceof Error
      ? error.message.replace(/^Action failed: /, "")
      : undefined,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
type Props = Parameters<typeof useHomePromptContext>[0];
let controller: ReturnType<typeof useHomePromptContext>;
let root: Root;
let container: HTMLDivElement;
let props: Props;
let page: string | undefined;
function Harness() {
  controller = useHomePromptContext(props);
  return null;
}
function picker(id = page!) {
  const item = controller.menuItems
    .flatMap((item) => item.children ?? [item])
    .find((item) => item.id === id);
  if (!item || !("picker" in item) || !item.picker)
    throw new Error("Missing shared picker");
  return item.picker;
}
const request = (extra = {}) => ({
  search: "",
  page: 1,
  signal: new AbortController().signal,
  ...extra,
});
async function render(nextPage?: string) {
  page = nextPage;
  await act(async () => root.render(<Harness />));
}
async function click(title: string) {
  await act(async () => picker().onSelect({ id: "ref", title }, request()));
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
  mocks.refresh = 0;
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
  it("offers a genuine setup link with no lone None choice when there are no systems", async () => {
    await render("system");
    const system = picker();
    expect(system.items).toEqual([]);
    expect(system.emptyMessage).toBe("homeContext.noSystems");
    expect(system.clearSelection).toBeUndefined();
    expect(system.footerAction?.label).toBe("homeContext.createSystem");
    await act(async () =>
      root.render(
        <MemoryRouter>
          {system.footerAction!.renderLink!(system.footerAction!.label)}
        </MemoryRouter>,
      ),
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/design-systems/setup",
    );
  });
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
    expect(picker().searchPlaceholder).toBe(label);
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
  it("forwards shared paging, search, cancellation and refresh without changing identity scope", async () => {
    await render("slides-reference");
    mocks.call.mockResolvedValue({
      items: [],
      hasMore: true,
      nextCursor: "cursor-3",
    });
    const input = request({ search: "campaign", page: 2, cursor: "cursor-2" });
    expect(await picker().load!(input)).toEqual({
      items: [],
      hasMore: true,
      nextCursor: "cursor-3",
    });
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "slides",
        operation: "list",
        search: "campaign",
        page: 2,
        cursor: "cursor-2",
      },
      { method: "GET", signal: input.signal },
    );
    const scope = picker().scopeKey;
    mocks.refresh = 1;
    await render("slides-reference");
    expect(picker()).toMatchObject({ scopeKey: scope, refreshKey: 1 });
  });
  it.each([
    { items: [] },
    { items: [], hasMore: true },
    { context: "not a list" },
  ])(
    "rejects malformed or unpageable Slides catalogs rather than returning empty success: %j",
    async (result) => {
      await render("slides-reference");
      mocks.call.mockResolvedValue(result);
      await expect(picker().load!(request())).rejects.toThrow(
        "homeContext.loadFailed",
      );
    },
  );
  it("surfaces cleaned load errors and retries the action on a fresh shared request", async () => {
    await render("slides-reference");
    mocks.call.mockRejectedValueOnce(
      new Error("Action failed: Peer unavailable"),
    );
    await expect(picker().load!(request())).rejects.toThrow("Peer unavailable");
    mocks.call.mockResolvedValueOnce({ items: [], hasMore: false });
    await expect(picker().load!(request())).resolves.toEqual({
      items: [],
      hasMore: false,
    });
  });
  it("supplies system selection, loading, error and retry as data, with no app render slot", async () => {
    props = {
      ...props,
      systemId: "system",
      systems: [
        { id: "system", title: "Chosen", ready: true },
        { id: "pending", title: "Pending", ready: false },
      ],
    };
    await render("system");
    expect(picker()).toMatchObject({
      selectedIds: ["system"],
      items: [
        { id: "system", title: "Chosen", disabled: false },
        { id: "pending", title: "Pending", disabled: true },
      ],
    });
    await act(async () => picker().clearSelection!.onSelect());
    expect(mocks.select).toHaveBeenCalledWith(null);
    props = { ...props, systems: [], systemsLoading: true };
    await render("system");
    expect(picker().loading).toBe(true);
    props = {
      ...props,
      systemsLoading: false,
      systemsError: new Error("Action failed: Catalog failed"),
      retrySystems: mocks.retry,
    };
    await render("system");
    expect(picker().error).toBe("Catalog failed");
    picker().onRetry?.();
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(
      controller.menuItems[0].children?.every((item) => !("render" in item)),
    ).toBe(true);
  });
  it("keeps Figma URL entry separate and identifies selected frames by file as well as node", async () => {
    await render("figma-reference");
    expect(picker().link).toMatchObject({
      placeholder: "homeContext.figmaUrl",
      submitLabel: "homeContext.browse",
    });
    const url = "https://www.figma.com/design/example-one/Example";
    mocks.call.mockResolvedValueOnce({
      items: [{ id: "1:2", title: "Frame" }],
      hasMore: false,
    });
    const result = await picker().load!(request({ url }));
    await act(async () => picker().onSelect(result.items[0], request({ url })));
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "figma",
        operation: "read",
        id: "1:2",
        nodeId: "1:2",
        figmaUrl: url,
        page: 1,
      },
      { method: "GET" },
    );
    expect(picker().selectedIds).toContain(result.items[0].id);
    mocks.call.mockResolvedValueOnce({
      items: [{ id: "1:2", title: "Other frame" }],
      hasMore: false,
    });
    const other = await picker().load!(
      request({ url: "https://www.figma.com/design/example-two/Example" }),
    );
    expect(picker().selectedIds).not.toContain(other.items[0].id);
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
