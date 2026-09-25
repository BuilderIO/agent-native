// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { callAction, query, identity } = vi.hoisted(() => ({
  callAction: vi.fn(),
  query: {
    data: undefined as unknown,
    error: null as Error | null,
    isFetching: false,
    refetch: vi.fn(),
  },
  identity: { email: "one@example.test", orgId: "one" },
}));
const translate = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => translate }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  actionErrorMessage: (error: Error) =>
    error?.message.replace(/^Action failed: /, ""),
  useSession: () => ({ session: identity }),
  useActionQuery: () => query,
}));
vi.mock("@agent-native/toolkit/composer", async () => ({
  ...(await vi.importActual("@agent-native/toolkit/composer/context-items")),
  ComposerContextSearchInput: ({
    onValueChange,
    onBack: _onBack,
    ...props
  }: {
    onValueChange: (value: string) => void;
    onBack: unknown;
  }) => (
    <input {...props} onChange={(event) => onValueChange(event.target.value)} />
  ),
}));
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandEmpty: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
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
    <button disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
}));
import { useSlidesComposerContext } from "./SlidesComposerContext";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  identity.email = "one@example.test";
  identity.orgId = "one";
  query.data = undefined;
  query.error = null;
  query.isFetching = false;
  callAction.mockImplementation(async (_action, args) => ({
    id: args.id,
    title: "Reference",
    context: "Visual language",
  }));
});
afterEach(cleanup);
const defaults = { defaultDesignSystemId: null, systems: [] };
const deck = { id: "deck", title: "Deck" };
const controls = { onBack: vi.fn(), onClose: vi.fn(), onResume: vi.fn() };

describe("Slides context readiness and identity", () => {
  it("blocks pending reads and retryable concrete failures before generation", async () => {
    let reject!: (error: Error) => void;
    callAction.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, defaultReferenceDeck: deck }),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("pending"),
    );
    await expect(result.current.beforeSend()).rejects.toThrow(
      "home.context.notReady",
    );
    await act(async () =>
      reject(new Error("Action failed: Deck access denied")),
    );
    expect(result.current.props.contextItems[0]).toMatchObject({
      status: "error",
      statusMessage: "Deck access denied",
    });
    await expect(result.current.beforeSend()).rejects.toThrow(
      "home.context.notReady",
    );
    callAction.mockResolvedValue({
      id: "deck",
      title: "Deck",
      context: "Recovered context",
    });
    act(() => result.current.props.onRetryContextItem());
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    let snapshot!: Awaited<ReturnType<typeof result.current.beforeSend>>;
    await act(async () => {
      snapshot = await result.current.beforeSend();
    });
    expect(snapshot.items[0].context).toBe("Recovered context");
    expect(Object.isFrozen(snapshot.items)).toBe(true);
  });
  it("does not resurrect removed context when a read finishes later", async () => {
    let resolve!: (result: unknown) => void;
    callAction.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() =>
      useSlidesComposerContext({ ...defaults, defaultReferenceDeck: deck }),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("pending"),
    );
    act(() => result.current.props.onRemoveContextItem("slides:deck:"));
    await act(async () =>
      resolve({ id: "deck", title: "Deck", context: "Late data" }),
    );
    expect(result.current.props.contextItems).toEqual([]);
    expect(
      localStorage.getItem("slides-home-context:one@example.test:one"),
    ).toContain('"references":[]');
  });
  it("resets selection for another identity and rejects an in-flight send", async () => {
    const { result, rerender } = renderHook(() =>
      useSlidesComposerContext({
        ...defaults,
        defaultReferenceDeck:
          identity.email === "one@example.test" ? deck : undefined,
      }),
    );
    await waitFor(() =>
      expect(result.current.props.contextItems[0]?.status).toBe("ready"),
    );
    let resolve!: (result: unknown) => void;
    callAction.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = result.current.beforeSend();
    const rejected = expect(pending).rejects.toThrow("home.context.loadFailed");
    identity.email = "two@example.test";
    identity.orgId = "two";
    rerender();
    await act(async () =>
      resolve({ id: "deck", title: "Deck", context: "Old identity context" }),
    );
    await rejected;
    expect(result.current.props.contextItems).toEqual([]);
  });
  it("keeps app and peer references under the agreed hierarchy and renders query errors", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    const entries = result.current.props.contextMenuItems;
    expect(entries.map((entry) => entry.id)).toEqual([
      "design-context",
      "slides",
    ]);
    expect(entries[0].children?.map((entry) => entry.id)).toEqual([
      "system",
      "design",
      "figma",
    ]);
    act(() => {
      entries[1].onSelect?.();
    });
    query.error = new Error("Action failed: Design app connection required");
    const action = result.current.props.contextMenuItems[1];
    render("render" in action ? action.render?.(controls) : null);
    expect(screen.getByRole("alert").textContent).toBe(
      "Design app connection required",
    );
    expect(screen.queryByText("home.context.empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "home.retry" }));
    expect(query.refetch).toHaveBeenCalledOnce();
  });
  it("makes malformed catalog responses visible instead of showing an empty catalog", async () => {
    const { result } = renderHook(() => useSlidesComposerContext(defaults));
    act(() => {
      result.current.props.contextMenuItems[1].onSelect?.();
    });
    query.data = { items: [] };
    const action = result.current.props.contextMenuItems[1];
    render("render" in action ? action.render?.(controls) : null);
    expect(screen.getByRole("alert").textContent).toBe(
      "home.context.loadFailed",
    );
  });
});
