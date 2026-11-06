// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/en-US";
function translate(key: string) {
  const value = key
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      en,
    );
  return typeof value === "string" ? value : key;
}
const mocks = vi.hoisted(() => ({
  action: vi.fn(),
  identity: { email: "viewer@example.test", orgId: "org-one" },
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  callAction: mocks.action,
  actionErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : undefined,
  useSession: () => ({ session: mocks.identity }),
  useChangeVersions: () => 0,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => translate,
  useFormatters: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("@/hooks/use-design-system-workflows", () => ({
  useDesignSystemWorkflows: () => false,
}));
vi.mock("./GoogleDriveConnectionCta", () => ({
  GoogleDriveConnectionCta: () => null,
}));
vi.mock("@/components/deck/SlideRenderer", () => ({ default: () => null }));
import { useSlidesComposerContext } from "./SlidesComposerContext";
const id = "example-presentation-id";
const url = `https://docs.google.com/presentation/d/${id}/edit`;
const source = {
  id,
  title: "Planning reference",
  url,
  context: "External presentation context",
};
let model: ReturnType<typeof useSlidesComposerContext>;
function Harness({ draftScope }: { draftScope?: string } = {}) {
  const context = useSlidesComposerContext({
    defaultDesignSystemId: null,
    systems: [],
    onCreateDesignSystem: () => {},
    ...(draftScope ? { draftScope, persistSelection: false } : {}),
  });
  model = context;
  const entry = context.props.contextMenuItems.find(
    (item) => item.id === "google-slides",
  );
  return (
    <>
      <button
        onClick={() => {
          if (entry && "onSelect" in entry) void entry.onSelect?.();
        }}
      >
        Google Slides source
      </button>
      <div data-testid="chips">
        {context.props.contextItems.map((item) => (
          <span key={item.key}>
            {item.title}: {item.status}
          </span>
        ))}
      </div>
      {context.dialogs}
    </>
  );
}
function open() {
  const button = screen.getByRole("button", { name: "Google Slides source" });
  button.focus();
  fireEvent.click(button);
  return button;
}
function fill(value = url) {
  fireEvent.change(
    screen.getByRole("textbox", { name: "Paste a Google Slides link" }),
    { target: { value } },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  mocks.identity.orgId = "org-one";
  mocks.action.mockResolvedValue(source);
});
afterEach(cleanup);
describe("Google Slides as chat context", () => {
  it("attaches a URL as a ready context chip and freezes fresh authorized text before send, without imports or navigation", async () => {
    render(<Harness />);
    open();
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Attach", exact: true }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("chips").textContent).toContain(
        "Planning reference: ready",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(model.selection.references).toEqual([
      { source: "google-slides", id, title: "Planning reference", url },
    ]);
    const saved = window.localStorage.getItem(
      "slides-home-context:viewer@example.test:org-one",
    );
    expect(saved).toContain(id);
    expect(saved).not.toContain(source.context);
    let snapshot: Awaited<ReturnType<typeof model.beforeSend>> | undefined;
    await act(async () => {
      snapshot = await model.beforeSend();
    });
    expect(snapshot?.text).toContain(source.context);
    expect(snapshot?.text).toContain(
      "Never import, clone, or append slides merely because a deck is attached",
    );
    expect(Object.isFrozen(snapshot?.items)).toBe(true);
    expect(mocks.action.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [action, args, options] of mocks.action.mock.calls) {
      expect(action).toBe("read-google-slides-context");
      expect(args).toEqual({ presentationUrl: url });
      expect(options).toMatchObject({ method: "GET" });
    }
  });
  it("blocks a send after presentation access is revoked rather than using the previously loaded body", async () => {
    render(<Harness />);
    open();
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Attach", exact: true }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("chips").textContent).toContain("ready"),
    );
    mocks.action.mockRejectedValue(
      new Error("Presentation access was revoked"),
    );
    await expect(model.beforeSend()).rejects.toThrow();
    expect(model.selection.references).toHaveLength(1);
    expect(mocks.action).toHaveBeenLastCalledWith(
      "read-google-slides-context",
      { presentationUrl: url },
      { method: "GET" },
    );
  });
  it("keeps the URL for retry on a read error, then cancels without adding context or losing focus", async () => {
    mocks.action.mockRejectedValueOnce(
      new Error("Presentation access was denied"),
    );
    render(<Harness />);
    const opener = open();
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Attach", exact: true }),
    );
    await screen.findByText("Presentation access was denied");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(url);
    expect(model.selection.references).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel", exact: true }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
  it("aborts a pending read on account scope changes and never stages its late response", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.action.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<Harness />);
    open();
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Attach", exact: true }),
    );
    const signal = mocks.action.mock.calls[0]?.[2]?.signal as
      | AbortSignal
      | undefined;
    mocks.identity.orgId = "org-two";
    view.rerender(<Harness />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(source));
    expect(model.selection.references).toEqual([]);
    expect(screen.getByTestId("chips").textContent).toBe("");
    open();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });
  it("rejects an unrelated URL without issuing any source read or import", () => {
    render(<Harness />);
    open();
    fill("https://example.com/presentation");
    expect(
      screen
        .getByRole("button", { name: "Attach", exact: true })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe(
      en.home.context.googleSlides.invalid,
    );
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("persists and restores Google metadata in a scoped agent composer draft, re-reading its content on remount", async () => {
    const view = render(<Harness draftScope="review-thread-one" />);
    open();
    fill();
    fireEvent.click(
      screen.getByRole("button", { name: "Attach", exact: true }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.getByTestId("chips").textContent).toContain(
        "Planning reference: ready",
      ),
    );
    const saved = window.localStorage.getItem(
      "agent-chat-composer-context:review-thread-one",
    );
    expect(saved).toContain('"source":"google-slides"');
    expect(saved).not.toContain(source.context);
    view.unmount();
    mocks.action.mockClear();
    render(<Harness draftScope="review-thread-one" />);
    await waitFor(() =>
      expect(screen.getByTestId("chips").textContent).toContain(
        "Planning reference: ready",
      ),
    );
    expect(mocks.action).toHaveBeenCalledWith(
      "read-google-slides-context",
      { presentationUrl: url },
      { method: "GET" },
    );
  });
});
