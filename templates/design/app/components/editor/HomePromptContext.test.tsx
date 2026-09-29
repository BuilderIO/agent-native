import type { AssistantChatComposerContext } from "@agent-native/toolkit/app/chat/chat";
// @vitest-environment happy-dom
import { snapshotComposerContextItems } from "@agent-native/toolkit/app/chat/composer/index";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignComposerContextProvider } from "./DesignComposerContextProvider";
import { useHomePromptContext } from "./HomePromptContext";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  refresh: 0,
  enabled: true,
  select: vi.fn(),
  navigate: vi.fn(),
  capabilities: {
    data: {
      sources: { figma: { available: true } },
      integrations: [] as Array<{
        id: string;
        label: string;
        kind: "provider-api" | "mcp";
      }>,
    },
  },
  session: {
    email: "user@example.com",
    orgId: "org-one",
    authUserId: undefined as string | undefined,
  },
}));
vi.mock(
  "@agent-native/toolkit/app/chat/composer/index",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/toolkit/app/chat/composer/index")
    >()),
    useAgentKitCapabilities: () => mocks.capabilities,
  }),
);
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => mocks.enabled,
}));
vi.mock("@/hooks/use-design-systems", () => ({
  useDesignSystems: () => ({
    designSystems: [],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("./design-start-pickers", () => ({
  designSystemPickerOptions: () => [],
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useSession: () => ({ session: mocks.session }),
  callAction: (...args: unknown[]) => mocks.call(...args),
  useChangeVersions: () => mocks.refresh,
  actionErrorMessage: (error: unknown) =>
    error instanceof Error
      ? error.message.replace(/^Action failed: /, "")
      : undefined,
}));
const translate = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => translate,
  useFormatters: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("@/components/design/DesignThumbnail", () => ({
  DesignThumbnail: () => null,
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => mocks.navigate,
}));
type Props = Parameters<typeof useHomePromptContext>[0];
const defaults: Props = {
  systems: [],
  systemId: null,
  onSystemChange: mocks.select,
  templates: [],
  templateId: null,
  onTemplateChange: mocks.select,
};
const cleanups: (() => void)[] = [];
function render(element: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    rerender: (next: ReactNode) => act(() => root.render(next)),
  };
}
function renderHook<T>(
  hook: (props: Props) => T,
  options?: { initialProps: Props },
) {
  const result = {} as { current: T };
  function Harness({ props }: { props: Props }) {
    result.current = hook(props);
    return null;
  }
  const view = render(<Harness props={options?.initialProps ?? defaults} />);
  return {
    result,
    rerender: (props = options?.initialProps ?? defaults) =>
      view.rerender(<Harness props={props} />),
  };
}
async function waitFor(assertion: () => unknown) {
  await act(async () => {});
  assertion();
}
const request = (extra = {}) => ({
  search: "",
  page: 1,
  signal: new AbortController().signal,
  ...extra,
});
const url = "https://www.figma.com/design/example-one/Example";
const website = "https://example.com/reference";
function picker(
  controller: ReturnType<typeof useHomePromptContext>,
  id = "figma-reference",
) {
  const item = controller.menuItems[0].children!.find((item) => item.id === id);
  if (!item || !("picker" in item) || !item.picker)
    throw new Error("Missing picker");
  return item.picker;
}
function batch(
  controller: ReturnType<typeof useHomePromptContext>,
  items: { id: string; title: string; url?: string }[],
) {
  const presentation = picker(controller).presentation;
  if (
    !presentation ||
    presentation === "submenu" ||
    presentation.mode !== "multiple"
  )
    throw new Error("Missing dialog");
  return presentation.onAttach(items, request({ url }));
}
const frame = (id: string, fileUrl = url) => ({
  id: `file:${encodeURIComponent(id)}`,
  title: `Frame ${id}`,
  url: fileUrl,
});
function addWebsite(
  controller: ReturnType<typeof useHomePromptContext>,
  value = website,
) {
  return picker(controller, "website-reference").onSelect!(
    { id: value, title: value, url: value },
    request({ url: value }),
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() {
        return storage.size;
      },
    },
  });
  mocks.enabled = true;
  mocks.refresh = 0;
  mocks.session = {
    email: "user@example.com",
    orgId: "org-one",
    authUserId: undefined,
  };
  mocks.capabilities = {
    data: { sources: { figma: { available: true } }, integrations: [] },
  };
  mocks.navigate.mockReset();
  mocks.call.mockImplementation(async (_action, args) => ({
    id: args.id ?? "website-hash",
    title: "Reference",
    context: "Bounded visual context",
    agentContext: "System tokens",
  }));
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("home prompt context", () => {
  it("restores only reference metadata across same-thread surface remounts and re-reads its content", async () => {
    let model!: AssistantChatComposerContext;
    const provider = (threadId: string, tabId: string) => (
      <DesignComposerContextProvider threadId={threadId} tabId={tabId} isActive>
        {(value) => {
          model = value;
          return null;
        }}
      </DesignComposerContextProvider>
    );
    const view = render(provider("thread", "sidebar-tab"));
    const action = model.menuItems[0].children!.find(
      (item) => item.id === "website-reference",
    )!;
    if (!("picker" in action) || !action.picker?.onSelect)
      throw new Error("Missing website picker");
    await act(async () =>
      action.picker!.onSelect!({ id: website, title: "Website" }, request()),
    );
    expect(model.contextItems[0].status).toBe("ready");
    view.rerender(null);
    mocks.call.mockResolvedValueOnce({
      id: "website-hash",
      title: "Website",
      context: "Fresh after handoff",
    });
    await act(async () => view.rerender(provider("thread", "page-tab")));
    expect(model.contextItems).toEqual([
      expect.objectContaining({
        context: "Fresh after handoff",
        status: "ready",
      }),
    ]);
    const stored = [...Array(window.localStorage.length)]
      .map((_, index) =>
        window.localStorage.getItem(window.localStorage.key(index)!),
      )
      .join("");
    expect(stored).toContain(website);
    expect(stored).not.toContain("Bounded visual context");
    expect(stored).not.toContain("Fresh after handoff");
    view.rerender(provider("other-thread", "other-tab"));
    expect(model.contextItems).toEqual([]);
    mocks.session.authUserId = "different-auth-user";
    view.rerender(provider("thread", "page-tab"));
    expect(model.contextItems).toEqual([]);
    mocks.session.authUserId = undefined;
    mocks.session.orgId = "different-org";
    view.rerender(provider("thread", "page-tab"));
    expect(model.contextItems).toEqual([]);
    mocks.session.orgId = "org-one";
    await act(async () => view.rerender(provider("thread", "page-tab")));
    expect(model.contextItems[0]?.status).toBe("ready");
    let prepared!: typeof model.contextItems;
    await act(async () => {
      prepared = await model.prepareSubmission(model.contextItems);
    });
    act(() => model.submissionAccepted(prepared));
    view.rerender(null);
    await act(async () => view.rerender(provider("thread", "sidebar-tab")));
    expect(model.contextItems).toEqual([]);
  });
  it("isolates provider selections by thread and account and hides inactive menus", async () => {
    const models = new Map<string, AssistantChatComposerContext>();
    const providers = (active: string) =>
      ["one", "two"].map((threadId) => (
        <DesignComposerContextProvider
          key={threadId}
          threadId={threadId}
          tabId={threadId}
          isActive={active === threadId}
        >
          {(model) => {
            models.set(threadId, model);
            return null;
          }}
        </DesignComposerContextProvider>
      ));
    const view = render(providers("one"));
    const action = models
      .get("one")!
      .menuItems[0].children!.find((item) => item.id === "design-reference")!;
    if (
      !("picker" in action) ||
      !action.picker ||
      !action.picker.presentation ||
      action.picker.presentation === "submenu" ||
      action.picker.presentation.mode !== "multiple"
    )
      throw new Error("Missing gallery");
    const gallery = action.picker.presentation;
    await act(async () =>
      gallery.onAttach([{ id: "one", title: "Reference" }], request()),
    );
    expect(models.get("one")!.contextItems).toHaveLength(1);
    expect(models.get("two")!.contextItems).toEqual([]);
    expect(models.get("two")!.menuItems).toEqual([]);
    view.rerender(providers("two"));
    expect(models.get("one")!.menuItems).toEqual([]);
    expect(() =>
      gallery.onAttach([{ id: "stale", title: "Stale" }], request()),
    ).toThrow("homeContext.loadFailed");
    mocks.session.orgId = "another-org";
    view.rerender(providers("one"));
    expect(models.get("one")!.contextItems).toEqual([]);
    expect(models.get("two")!.contextItems).toEqual([]);
    const newAction = models
      .get("one")!
      .menuItems[0].children!.find((item) => item.id === "website-reference")!;
    if (!("picker" in newAction) || !newAction.picker?.onSelect)
      throw new Error("Missing website action");
    await act(async () =>
      newAction.picker!.onSelect!({ id: website, title: "Website" }, request()),
    );
    expect(models.get("one")!.contextItems).toHaveLength(1);
    mocks.session.authUserId = "another-auth-identity";
    view.rerender(providers("one"));
    expect(models.get("one")!.contextItems).toEqual([]);
  });

  it("clears a successfully revalidated reference even when its fetched content changes", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const captured = snapshotComposerContextItems(result.current.contextItems);
    mocks.call.mockResolvedValueOnce({
      id: "website-hash",
      title: "Updated",
      context: "Refreshed context",
    });
    const prepared = await result.current.prepareSubmission(captured);
    expect(prepared![0].context).toBe("Refreshed context");
    expect(result.current.contextItems).toHaveLength(1);
    act(() => result.current.submissionAccepted(prepared!));
    expect(result.current.contextItems).toEqual([]);
  });

  it("preserves replacements and additions while a captured submission is resolving", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const captured = snapshotComposerContextItems(result.current.contextItems);
    let resolve!: (value: unknown) => void;
    mocks.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = result.current.prepareSubmission(captured);
    await act(async () => {
      addWebsite(result.current);
      addWebsite(result.current, "https://example.com/second");
    });
    resolve({
      id: "website-hash",
      title: "Original",
      context: "Revalidated original",
    });
    const prepared = await pending;
    expect(prepared).toHaveLength(1);
    act(() => result.current.submissionAccepted(prepared!));
    expect(result.current.contextItems).toHaveLength(2);
    expect(
      result.current.contextItems.every((item) => item.status === "ready"),
    ).toBe(true);
  });

  it("uses captured versions even when preparation starts after the selection changes", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const captured = snapshotComposerContextItems(result.current.contextItems);
    const capturedController = result.current;
    await act(async () => addWebsite(result.current));
    const prepared = await capturedController.prepareSubmission(captured);
    act(() => result.current.submissionAccepted(prepared!));
    expect(result.current.contextItems).toHaveLength(1);
  });
  it("does not clear a newer design system when an older selection is accepted", async () => {
    const { result, rerender } = renderHook(
      (props: Props) => useHomePromptContext(props),
      { initialProps: { ...defaults, systemId: "first" } },
    );
    await waitFor(() =>
      expect(result.current.contextItems[0]?.status).toBe("ready"),
    );
    const capturedController = result.current;
    const captured = snapshotComposerContextItems(result.current.contextItems);
    rerender({ ...defaults, systemId: "second" });
    await waitFor(() =>
      expect(result.current.contextItems[0]?.status).toBe("ready"),
    );
    const prepared = await capturedController.prepareSubmission(captured);
    expect(mocks.call).toHaveBeenLastCalledWith(
      "get-design-system",
      { id: "first" },
      { method: "GET" },
    );
    mocks.select.mockClear();
    act(() => result.current.submissionAccepted(prepared!));
    expect(mocks.select).not.toHaveBeenCalled();
    expect(result.current.contextItems).toHaveLength(1);
  });
  it("does not remove staged references when submit-time revalidation fails", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    mocks.call.mockRejectedValueOnce(new Error("Access revoked"));
    await act(async () => {
      await expect(
        result.current.prepareSubmission(
          snapshotComposerContextItems(result.current.contextItems),
        ),
      ).rejects.toThrow("Access revoked");
    });
    expect(result.current.contextItems).toHaveLength(1);
    expect(result.current.contextItems[0].status).toBe("error");
  });
  it("blocks submission and retains an error selection when an attached integration is revoked", async () => {
    const integration = {
      id: "provider-api:figma",
      label: "Figma",
      kind: "provider-api" as const,
    };
    mocks.capabilities.data.integrations = [integration];
    const { result, rerender } = renderHook(() =>
      useHomePromptContext(defaults),
    );
    await act(async () =>
      picker(result.current, "integrations").onSelect!(
        { id: integration.id, title: integration.label },
        request(),
      ),
    );
    const captured = snapshotComposerContextItems(result.current.contextItems);
    expect(captured[0].status).toBe("ready");
    mocks.capabilities.data.integrations = [];
    rerender();
    mocks.call.mockRejectedValueOnce(
      Object.assign(new Error("Integration is no longer available"), {
        status: 403,
      }),
    );
    const send = vi.fn();
    await act(async () => {
      await expect(
        result.current.prepareSubmission(captured).then(send),
      ).rejects.toThrow("Integration is no longer available");
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.current.contextItems).toEqual([
      expect.objectContaining({
        key: captured[0].key,
        status: "error",
        context: "",
        statusMessage: "Integration is no longer available",
      }),
    ]);
  });
  it("keeps references available with design systems disabled, with no hidden system read", () => {
    mocks.enabled = false;
    const { result } = renderHook(() =>
      useHomePromptContext({ ...defaults, systemId: "saved-system" }),
    );
    expect(result.current.menuItems.map((item) => item.id)).toEqual(["design"]);
    expect(
      result.current.menuItems[0].children?.map((item) => item.id),
    ).toEqual([
      "design-reference",
      "figma-reference",
      "website-reference",
      "integrations",
    ]);
    expect(result.current.contextItems).toEqual([]);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("lists, attaches, revalidates and removes a design through the source action", async () => {
    const id = "design-reference";
    const source = "design";
    mocks.enabled = false;
    const { result } = renderHook(() => useHomePromptContext(defaults));
    expect(result.current.menuItems[0].children).toContainEqual(
      expect.objectContaining({
        id,
        label: "homeContext.referenceDesign",
        intent: "add-context",
      }),
    );
    const input = request({ search: "campaign", page: 2, cursor: "next" });
    const references = [{ id: "reference-one", title: "Campaign" }];
    mocks.call.mockResolvedValueOnce({
      designs: references.map((item) => ({
        ...item,
        updatedAt: "2026-09-28T00:00:00Z",
        previewHtml: "<h1>Campaign</h1>",
      })),
      hasMore: false,
    });
    const sourcePicker = picker(result.current, id);
    const listed = await sourcePicker.load!(input);
    expect(mocks.call).toHaveBeenLastCalledWith(
      "list-designs",
      {
        includePreview: "true",
        pageSize: 12,
        search: "campaign",
        page: 2,
      },
      { method: "GET", signal: input.signal },
    );
    expect(result.current.contextItems).toEqual([]);
    expect(sourcePicker.link).toBeUndefined();
    expect(sourcePicker.presentation).toMatchObject({ layout: "gallery" });
    expect(listed.items[0].preview).toBeDefined();
    const presentation = sourcePicker.presentation;
    if (
      !presentation ||
      presentation === "submenu" ||
      presentation.mode !== "multiple"
    )
      throw new Error("Missing reference dialog");
    await act(async () => presentation.onAttach(listed.items, input));
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      { source, operation: "read", id: "reference-one", page: 1 },
      { method: "GET" },
    );
    expect(picker(result.current, id).selectedIds).toEqual(["reference-one"]);
    expect(result.current.contextItems[0]).toMatchObject({
      status: "ready",
      context: "Bounded visual context",
    });
    mocks.call.mockResolvedValueOnce({
      id: "reference-one",
      title: "Campaign",
      context: "Fresh reference",
    });
    const submitted = await result.current.prepareSubmission(
      snapshotComposerContextItems(result.current.contextItems),
    );
    expect(submitted?.[0].context).toBe("Fresh reference");
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      { source, operation: "read", id: "reference-one", page: 1 },
      { method: "GET" },
    );
    act(() => result.current.remove(result.current.contextItems[0].key));
    expect(result.current.contextItems).toEqual([]);
    expect(picker(result.current, id).selectedIds).toEqual([]);
  });
  it("restores the real system creator only when enabled; empty has no None", () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    const system = picker(result.current, "system");
    expect(system.items).toEqual([]);
    expect(system.emptyMessage).toBe("homeContext.noSystems");
    expect(system.clearSelection).toBeUndefined();
    const view = render(
      <MemoryRouter>
        {system.footerAction!.renderLink!(system.footerAction!.label)}
      </MemoryRouter>,
    );
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe(
      "/design-systems/setup",
    );
  });
  it("uses ordinary shared dialogs with source labels, no app render slots or URL list", () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    expect(picker(result.current)).toMatchObject({
      presentation: { type: "dialog", mode: "multiple" },
      searchPlaceholder: "homeContext.searchFrames",
      link: {
        label: "homeContext.figmaUrlLabel",
        placeholder: "homeContext.figmaUrl",
      },
    });
    expect(picker(result.current).onSelect).toBeUndefined();
    expect(picker(result.current, "website-reference")).toMatchObject({
      presentation: { type: "dialog", mode: "url" },
    });
    expect(picker(result.current, "website-reference").load).toBeUndefined();
    expect(
      result.current.menuItems[0].children?.every(
        (entry) => !("render" in entry),
      ),
    ).toBe(true);
  });
  it("gates Figma on backend readiness and exposes connected integrations as invocation intents", async () => {
    mocks.capabilities = {
      data: {
        sources: { figma: { available: false } },
        integrations: [
          { id: "github", label: "GitHub", kind: "provider-api" },
          { id: "mcp:org_team-1_notion", label: "notion", kind: "mcp" },
        ],
      },
    };
    const { result } = renderHook(() => useHomePromptContext(defaults));
    const entries = result.current.menuItems[0].children!;
    expect(entries.some((entry) => entry.id === "figma-reference")).toBe(false);
    const integrations = entries.find((entry) => entry.id === "integrations");
    expect(integrations).toMatchObject({ intent: "invoke-integration" });
    const integrationPicker = picker(result.current, "integrations");
    expect(integrationPicker.items).toEqual([
      { id: "github", title: "GitHub" },
      { id: "mcp:org_team-1_notion", title: "notion" },
    ]);
    await act(async () =>
      integrationPicker.onSelect!({ id: "github", title: "GitHub" }, request()),
    );
    expect(mocks.call).toHaveBeenCalledWith(
      "read-composer-source",
      { source: "integration", operation: "read", id: "github", page: 1 },
      { method: "GET" },
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("lists without staging, then attaches two canonical per-frame URLs together", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    const other = "https://www.figma.com/design/example-two/Frame?node-id=1-2";
    mocks.call.mockResolvedValueOnce({
      items: [
        { id: "1:2", title: "One", url: url + "?node-id=1-2" },
        { id: "1:2", title: "Two", url: other },
      ],
      hasMore: false,
    });
    const listed = await picker(result.current).load!(request({ url }));
    expect(result.current.contextItems).toEqual([]);
    await act(async () => batch(result.current, [...listed.items]));
    expect(result.current.contextItems).toHaveLength(2);
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "figma",
        operation: "read",
        id: "1:2",
        nodeId: "1:2",
        figmaUrl: other,
        page: 1,
      },
      { method: "GET" },
    );
    expect(picker(result.current).selectedIds).toEqual(
      listed.items.map((item) => item.id),
    );
  });
  it("deduplicates before enforcing the 20-reference limit, with no partial staging", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () =>
      batch(
        result.current,
        Array.from({ length: 19 }, (_, i) => frame(`1:${i}`)),
      ),
    );
    await act(async () => batch(result.current, [frame("1:0"), frame("1:19")]));
    const calls = mocks.call.mock.calls.length;
    expect(() => batch(result.current, [frame("1:20"), frame("1:21")])).toThrow(
      "homeContext.tooMany",
    );
    expect(result.current.contextItems).toHaveLength(20);
    expect(mocks.call).toHaveBeenCalledTimes(calls);
  });
  it.each([201, 2048])(
    "reads a %i-character website URL without sending it as an id, including retry and submit",
    async (length) => {
      const value = website.padEnd(length, "a");
      const { result } = renderHook(() => useHomePromptContext(defaults));
      expect(
        picker(result.current, "website-reference").link!.validate!(value),
      ).toBeUndefined();
      await act(async () => addWebsite(result.current, value));
      await act(async () =>
        result.current.retry(result.current.contextItems[0].key),
      );
      await act(async () =>
        result.current.prepareSubmission(
          snapshotComposerContextItems(result.current.contextItems),
        ),
      );
      expect(mocks.call.mock.calls).toHaveLength(3);
      for (const [, params] of mocks.call.mock.calls)
        expect(params).toEqual({
          source: "website",
          operation: "read",
          url: value,
          page: 1,
        });
    },
  );
  it("rejects oversized URLs locally and accepts surrounding whitespace", () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    expect(picker(result.current).link!.validate!(url.padEnd(2049, "a"))).toBe(
      "homeContext.invalidFigmaUrl",
    );
    expect(
      picker(result.current, "website-reference").link!.validate!(
        website.padEnd(2049, "a"),
      ),
    ).toBe("homeContext.invalidWebsiteUrl");
    expect(
      picker(result.current).link!.validate!("  " + url + "  "),
    ).toBeUndefined();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("shows genuine provider failure, blocks sending, then retries and removes", async () => {
    const pending = deferred();
    mocks.call.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useHomePromptContext(defaults));
    act(() => batch(result.current, [frame("1:2")]));
    expect(() =>
      snapshotComposerContextItems(result.current.contextItems),
    ).toThrow();
    await act(async () =>
      pending.reject(new Error("Action failed: Figma connection required")),
    );
    expect(result.current.contextItems[0]).toMatchObject({
      status: "error",
      statusMessage: "Figma connection required",
    });
    expect(() =>
      snapshotComposerContextItems(result.current.contextItems),
    ).toThrow();
    await act(async () =>
      result.current.retry(result.current.contextItems[0].key),
    );
    const frozen = snapshotComposerContextItems(result.current.contextItems);
    act(() => result.current.remove(result.current.contextItems[0].key));
    expect(result.current.contextItems).toEqual([]);
    expect(frozen[0].context).toBe("Bounded visual context");
  });
  it("does not resurrect a removed or re-added reference from an old response", async () => {
    const old = deferred(),
      next = deferred();
    mocks.call
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useHomePromptContext(defaults));
    act(() => addWebsite(result.current));
    act(() => result.current.remove(result.current.contextItems[0].key));
    act(() => addWebsite(result.current));
    await act(async () =>
      old.resolve({ id: "ref", title: "Old", context: "Old" }),
    );
    expect(result.current.contextItems[0].status).toBe("pending");
    await act(async () =>
      next.resolve({ id: "ref", title: "New", context: "New" }),
    );
    expect(result.current.contextItems[0].context).toBe("New");
  });
  it("clears identity-specific context and prevents pending reads repopulating", async () => {
    const old = deferred();
    mocks.call.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(() =>
      useHomePromptContext(defaults),
    );
    act(() => addWebsite(result.current));
    mocks.session = {
      email: "other@example.com",
      orgId: "other",
      authUserId: undefined,
    };
    rerender();
    await act(async () =>
      old.resolve({ id: "ref", title: "Private", context: "Old account" }),
    );
    expect(result.current.contextItems).toEqual([]);
    expect(mocks.select).toHaveBeenCalledWith(null);
  });
  it("revalidates access, freezes fresh text, and makes revoked access visibly blocking", async () => {
    const { result } = renderHook(() => useHomePromptContext(defaults));
    await act(async () => addWebsite(result.current));
    const original = snapshotComposerContextItems(result.current.contextItems);
    mocks.call.mockResolvedValueOnce({
      id: "ref",
      title: "Reference",
      context: "Fresh",
    });
    const fresh = await result.current.prepareSubmission(original);
    expect(fresh?.[0].context).toBe("Fresh");
    expect(Object.isFrozen(fresh)).toBe(true);
    expect(original[0].context).toBe("Bounded visual context");
    mocks.call.mockRejectedValueOnce(
      new Error("Action failed: Access revoked"),
    );
    await act(async () => {
      await expect(result.current.prepareSubmission(fresh)).rejects.toThrow(
        "Access revoked",
      );
    });
    expect(result.current.contextItems[0]).toMatchObject({
      context: "",
      status: "error",
      statusMessage: "Access revoked",
    });
  });
  it("captures selected system ids before awaiting and binds context to the current id", async () => {
    const { result, rerender } = renderHook(
      (props: Props) => useHomePromptContext(props),
      {
        initialProps: {
          ...defaults,
          systemId: "a",
          systems: [{ id: "a", title: "A", ready: true }],
        },
      },
    );
    await waitFor(() =>
      expect(result.current.contextItems[0].status).toBe("ready"),
    );
    const pending = deferred();
    mocks.call.mockReturnValueOnce(pending.promise);
    const submitted = result.current.prepareSubmission(
      snapshotComposerContextItems(result.current.contextItems),
    );
    rerender({ ...defaults, systemId: null });
    await act(async () => pending.resolve({ agentContext: "Validated A" }));
    expect((await submitted)?.[0].context).toBe("Validated A");
    expect(result.current.contextItems).toEqual([]);
  });
  it("blocks in-flight submit across org changes and permits metadata-only templates", async () => {
    const { result, rerender } = renderHook(() =>
      useHomePromptContext({
        ...defaults,
        templates: [{ id: "tpl", title: "Template", isBuiltIn: true }],
        templateId: "tpl",
      }),
    );
    expect(
      (
        await result.current.prepareSubmission(
          snapshotComposerContextItems(result.current.contextItems),
        )
      )?.[0].context,
    ).toBe("");
    expect(mocks.call).not.toHaveBeenCalled();
    await act(async () => addWebsite(result.current));
    const pending = deferred();
    mocks.call.mockReturnValueOnce(pending.promise);
    const submitted = result.current.prepareSubmission(
      snapshotComposerContextItems(result.current.contextItems),
    );
    const rejection = expect(submitted).rejects.toThrow(
      "homeContext.loadFailed",
    );
    mocks.session = {
      email: "other@example.com",
      orgId: "other",
      authUserId: undefined,
    };
    rerender();
    await act(async () =>
      pending.resolve({ id: "ref", title: "Old", context: "Old" }),
    );
    await rejection;
  });
  it("forwards search, paging, abort and live refresh without changing identity scope", async () => {
    const { result, rerender } = renderHook(() =>
      useHomePromptContext(defaults),
    );
    mocks.call.mockResolvedValueOnce({
      items: [],
      hasMore: true,
      nextCursor: "third",
    });
    const input = request({ url, search: "campaign", page: 2, cursor: "next" });
    await picker(result.current).load!(input);
    expect(mocks.call).toHaveBeenLastCalledWith(
      "read-composer-source",
      {
        source: "figma",
        operation: "list",
        search: "campaign",
        page: 2,
        cursor: "next",
        figmaUrl: url,
      },
      { method: "GET", signal: input.signal },
    );
    const scope = picker(result.current).scopeKey;
    mocks.refresh = 3;
    rerender();
    expect(picker(result.current)).toMatchObject({
      scopeKey: scope,
      refreshKey: 3,
    });
  });
  it.each([{ items: [] }, { context: "not a list" }])(
    "rejects malformed catalogs %j",
    async (data) => {
      const { result } = renderHook(() => useHomePromptContext(defaults));
      mocks.call.mockResolvedValueOnce(data);
      await expect(
        picker(result.current).load!(request({ url })),
      ).rejects.toThrow("homeContext.loadFailed");
    },
  );
});
