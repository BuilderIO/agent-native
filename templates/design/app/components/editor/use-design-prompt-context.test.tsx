// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  design: undefined as { data: string } | undefined,
  invalidate: vi.fn().mockResolvedValue(undefined),
  t: (key: string) => key,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => ({
    session: { email: "qa@example.test", orgId: "qa-org" },
  }),
  callAction: mocks.callAction,
  useActionQuery: () => ({ data: mocks.design }),
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
}));
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => mocks.t }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));

import type { DesignContextPage } from "./DesignContextPicker";
import { useDesignPromptContext } from "./use-design-prompt-context";

let controller: ReturnType<typeof useDesignPromptContext>;
let root: Root;
const onSystemChange = vi.fn();
function Harness(props: {
  selectedSystemId?: string | null;
  designId?: string;
  localScopeKey?: string;
  originScopeKey?: string;
}) {
  controller = useDesignPromptContext({ ...props, onSystemChange });
  return null;
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.callAction.mockReset();
  localStorage.clear();
  mocks.design = undefined;
  onSystemChange.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe("Design prompt context resolution", () => {
  it("separates return origin identity without orphaning stored home context", async () => {
    const reference = {
      id: "saved-system",
      ownerApp: "design",
      consumedRevision: 4,
    };
    const key = "design-system-composer:qa@example.test:qa-org:local:";
    localStorage.setItem(key, JSON.stringify(reference));
    mocks.callAction.mockResolvedValue({
      title: "Saved brand",
      data: "{}",
      agentContext: "Saved tokens",
    });
    await act(async () =>
      root.render(<Harness originScopeKey="design:home" />),
    );
    expect(controller.draftId).toBe(
      "qa@example.test:qa-org:local::design:home",
    );
    expect(controller.systemReference).toEqual(reference);
    await act(async () => {
      controller.changeSystem(reference.id, {
        ...reference,
        ownerApp: "design",
      });
      await controller.flush();
    });
    expect(localStorage.getItem(key)).toBe(JSON.stringify(reference));
    expect(localStorage.getItem(`${key}:design:home`)).toBeNull();
  });
  it("retains one owner-qualified content pin through Use, retry, and reload", async () => {
    mocks.callAction.mockResolvedValue({
      title: "Cross-app brand",
      data: '{"colors":{"primary":"#123456"}}',
      agentContext: "Actual saved system context",
    });
    await act(async () => root.render(<Harness localScopeKey="owner-ref" />));
    const reference = {
      id: "owner-system",
      ownerApp: "slides" as const,
      consumedRevision: 7,
    };
    await act(async () => {
      controller.changeSystem(reference.id, reference);
      await controller.flush();
    });
    expect(onSystemChange).toHaveBeenLastCalledWith(null);
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-design-system",
      reference,
      { method: "GET" },
    );
    expect(
      controller.contextItems.filter((item) => item.key === "design-system"),
    ).toHaveLength(1);
    await act(async () => {
      controller.changeSystem(reference.id, reference);
      await controller.flush();
    });
    expect(
      controller.contextItems.filter((item) => item.key === "design-system"),
    ).toHaveLength(1);
    await act(async () => root.render(null));
    await act(async () => root.render(<Harness localScopeKey="owner-ref" />));
    expect(controller.systemReference).toEqual(reference);
    expect(controller.contextItems[0].context).toContain(
      '"consumedRevision":7',
    );
  });
  it("attaches immediately as pending, then resolves without another confirmation", async () => {
    let finish!: (value: unknown) => void;
    mocks.callAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => root.render(<Harness />));
    await act(async () =>
      controller.selectSource({ source: "design", id: "one", title: "First" }),
    );
    expect(controller.contextItems).toEqual([
      expect.objectContaining({
        title: "First",
        status: "pending",
        context: "",
      }),
    ]);
    await act(async () =>
      finish({ id: "one", title: "First", context: "Actual source" }),
    );
    expect(controller.contextItems).toEqual([
      expect.objectContaining({ status: "ready", context: "Actual source" }),
    ]);
  });

  it("keeps a failed selection retryable and resolves that same chip on retry", async () => {
    mocks.callAction.mockRejectedValue(new Error("Access denied"));
    await act(async () => root.render(<Harness />));
    await act(async () =>
      controller.selectSource({ source: "design", id: "one", title: "First" }),
    );
    expect(controller.contextItems).toEqual([
      expect.objectContaining({
        title: "First",
        status: "error",
        statusMessage: "Access denied",
      }),
    ]);
    const key = controller.contextItems[0].key;
    mocks.callAction.mockResolvedValue({
      id: "one",
      title: "First",
      context: "Actual source",
    });
    await act(async () => controller.onRetryContextItem(key));
    expect(controller.contextItems).toEqual([
      expect.objectContaining({
        key,
        status: "ready",
        context: "Actual source",
      }),
    ]);
  });

  it("does not restore a removed selection or accept an old result in a new scope", async () => {
    const pending: ((value: unknown) => void)[] = [];
    mocks.callAction.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    await act(async () => root.render(<Harness localScopeKey="a" />));
    await act(async () =>
      controller.selectSource({ source: "design", id: "one", title: "First" }),
    );
    const key = controller.contextItems[0].key;
    await act(async () => controller.onRemoveContextItem(key));
    await act(async () =>
      pending[0]({ id: "one", title: "First", context: "Late removed source" }),
    );
    expect(controller.contextItems).toEqual([]);
    await act(async () =>
      controller.selectSource({ source: "design", id: "two", title: "Second" }),
    );
    await act(async () => root.render(<Harness localScopeKey="b" />));
    await act(async () =>
      pending[1]({ id: "two", title: "Second", context: "Wrong scope" }),
    );
    expect(controller.contextItems).toEqual([]);
  });

  it("keeps the newest read when a removed reference is selected again", async () => {
    const pending: ((value: unknown) => void)[] = [];
    mocks.callAction.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const source = { source: "design" as const, id: "one", title: "First" };
    await act(async () => root.render(<Harness />));
    await act(async () => controller.selectSource(source));
    await act(async () =>
      controller.onRemoveContextItem(controller.contextItems[0].key),
    );
    await act(async () => controller.selectSource(source));
    await act(async () => pending[0]({ ...source, context: "Old read" }));
    expect(controller.contextItems[0].status).toBe("pending");
    await act(async () => pending[1]({ ...source, context: "New read" }));
    expect(controller.contextItems[0]).toMatchObject({
      status: "ready",
      context: "New read",
    });
  });

  it("resumes the systems page after creation without relying on onSelect replay", async () => {
    await act(async () => root.render(<Harness />));
    const systems = controller.contextMenuItems[0].children![0];
    if (systems.children) throw new Error("Expected a systems action");
    await act(async () => systems.onSelect!());
    const controls = {
      onBack: vi.fn(),
      onClose: vi.fn(() => systems.onDismiss?.()),
      onResume: vi.fn(),
    };
    const originalPage = systems.render!(controls) as ReactElement<
      ComponentProps<typeof DesignContextPage>
    >;
    originalPage.props.onSearchChange!("Primer");
    await act(async () => controller.createSystem(controls));
    expect(controller.view).toBe("create");
    await act(async () => systems.onDismiss?.());
    expect(controller.view).toBe("create");
    await act(async () => controller.resumePicker());
    expect(controls.onResume).toHaveBeenCalledOnce();
    expect(controller.view).toBe("systems");
    const resumedPage = systems.render!(controls) as ReactElement<
      ComponentProps<typeof DesignContextPage>
    >;
    expect(resumedPage.props.initialSearch).toBe("Primer");
    expect(resumedPage.props.controller).toBe(controller);
  });

  it("resolves an existing system, keeps explicit removal empty, and never writes a default", async () => {
    mocks.callAction.mockResolvedValue({
      title: "Real system",
      data: '{"colors":{"primary":"#123456"}}',
      agentContext: "Stored design tokens",
    });
    await act(async () => root.render(<Harness selectedSystemId="system-1" />));
    expect(controller.contextItems).toEqual([
      expect.objectContaining({
        title: "Real system",
        status: "ready",
        context: "Stored design tokens",
      }),
    ]);
    await act(async () => controller.onRemoveContextItem("design-system"));
    expect(onSystemChange).toHaveBeenCalledWith(null);
    await act(async () => root.render(<Harness selectedSystemId={null} />));
    expect(controller.contextItems).toEqual([]);
    expect(
      mocks.callAction.mock.calls.every(
        ([name]) => name === "get-design-system",
      ),
    ).toBe(true);
  });

  it("shows pending while resolving and errors on empty or indexing systems", async () => {
    let finish!: (value: unknown) => void;
    mocks.callAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => root.render(<Harness selectedSystemId="empty" />));
    expect(controller.contextItems[0].status).toBe("pending");
    await act(async () =>
      finish({
        title: "Empty",
        data: "{}",
        agentContext: "Generic instructions",
      }),
    );
    expect(controller.contextItems[0].status).toBe("error");
    mocks.callAction.mockResolvedValue({
      title: "Indexing",
      data: '{"source":"builder","builderStatus":"in-progress"}',
      agentContext: "Waiting",
      builder: { docCount: 0, tokenValues: {} },
    });
    await act(async () => root.render(<Harness selectedSystemId="indexing" />));
    expect(controller.contextItems[0].status).toBe("error");
  });

  it("rehydrates saved refs, retains inaccessible sources for retry/removal, and isolates another project", async () => {
    const ref = {
      source: "design",
      id: "source-design",
      title: "Existing work",
    };
    mocks.design = { data: JSON.stringify({ composerContext: [ref] }) };
    mocks.callAction.mockRejectedValue(new Error("Access denied"));
    await act(async () => root.render(<Harness designId="project-a" />));
    expect(mocks.callAction).toHaveBeenCalledWith(
      "read-composer-source",
      { source: "design", operation: "read", id: "source-design" },
      { method: "GET" },
    );
    expect(controller.contextItems[0]).toMatchObject({
      status: "error",
      statusMessage: "Access denied",
    });
    mocks.design = { data: "{}" };
    await act(async () => root.render(<Harness designId="project-b" />));
    expect(controller.contextItems).toEqual([]);
  });

  it("does not accept filename-only source responses", async () => {
    await act(async () => root.render(<Harness />));
    expect(() =>
      controller.attach(
        { source: "design", id: "source", title: "Source" },
        { id: "source", title: "Source", context: "" },
      ),
    ).toThrow();
    expect(controller.contextItems).toEqual([]);
  });

  it("does not reread references for unrelated project changes or resurrect a removed pending source", async () => {
    const ref = { source: "design", id: "source", title: "Source" };
    let finish!: (value: unknown) => void;
    mocks.design = { data: JSON.stringify({ composerContext: [ref] }) };
    mocks.callAction.mockImplementation((name) =>
      name === "read-composer-source"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({}),
    );
    await act(async () => root.render(<Harness designId="project" />));
    const key = controller.contextItems[0].key;
    await act(async () => controller.onRemoveContextItem(key));
    await act(async () =>
      finish({ id: "source", title: "Source", context: "Late context" }),
    );
    expect(controller.contextItems).toEqual([]);
    mocks.design = {
      data: JSON.stringify({ composerContext: [ref], viewport: "unrelated" }),
    };
    await act(async () => root.render(<Harness designId="project" />));
    expect(
      mocks.callAction.mock.calls.filter(
        ([name]) => name === "read-composer-source",
      ),
    ).toHaveLength(1);
    expect(controller.contextItems).toEqual([]);
  });

  it("blocks sending when an explicit system removal could not be saved", async () => {
    onSystemChange.mockRejectedValue(new Error("Write denied"));
    await act(async () => root.render(<Harness />));
    await act(async () => controller.changeSystem(null));
    expect(controller.contextItems).toContainEqual(
      expect.objectContaining({
        key: "context-system-save",
        status: "error",
        statusMessage: "Write denied",
      }),
    );
    await expect(controller.flush()).rejects.toThrow("Write denied");
    onSystemChange.mockResolvedValue(undefined);
    await act(async () => controller.onRetryContextItem("context-system-save"));
    await expect(controller.flush()).resolves.toBeUndefined();
    expect(controller.contextItems).toEqual([]);
  });
});
