// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "../../../i18n";
import {
  otherViewerCount,
  useDashboardSaveFeedback,
} from "./dashboard-save-feedback";
import type { DashboardSaveOutcome } from "./dashboard-save-queue";

const toastMock = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const ME = "me@example.com";
type SaveOutcome = DashboardSaveOutcome;
const WROTE = { changed: true, updatedAt: "v1", revisionId: "rev1" };

let container: HTMLDivElement;
let root: Root;

let track: ReturnType<typeof useDashboardSaveFeedback>;
function FeedbackProbe(props: {
  dashboardId?: string;
  shared: boolean;
  otherViewers: number;
  onUndo: () => void;
}) {
  track = useDashboardSaveFeedback({ dashboardId: "d1", ...props });
  return null;
}

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        {node}
      </AgentNativeI18nProvider>,
    );
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("otherViewerCount", () => {
  it("counts each other person once, leaving out you and the agent", () => {
    const user = (email: string) => ({ name: email, email, color: "" });
    expect(
      otherViewerCount(
        [
          user("Me@Example.com"),
          user("bob@example.com"),
          user("BOB@example.com "),
          user("agent@system"),
          user("ana@example.com"),
        ],
        ME,
      ),
    ).toBe(2);
    expect(otherViewerCount([user(ME)], ME)).toBe(0);
  });
});

describe("useDashboardSaveFeedback", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("turns one toast from saving into saved, with the viewer count and Undo", async () => {
    const onUndo = vi.fn();
    render(<FeedbackProbe shared otherViewers={2} onUndo={onUndo} />);
    const save = deferred<SaveOutcome>();

    act(() => {
      void track(save.promise);
    });
    expect(toastMock.loading).toHaveBeenCalledWith("Saving for everyone…", {
      id: "dashboard-save:d1",
    });

    await act(async () => save.resolve(WROTE));
    const [message, options] = toastMock.success.mock.calls[0];
    expect(message).toBe("Saved for everyone");
    expect(options).toMatchObject({
      id: "dashboard-save:d1",
      description: "2 others have it open",
      action: { label: "Undo" },
    });
    options.action.onClick();
    expect(onUndo).toHaveBeenCalledExactlyOnceWith({
      revisionId: "rev1",
      updatedAt: "v1",
    });
  });

  it("leaves the toast pending until the newest save lands", async () => {
    render(<FeedbackProbe shared={false} otherViewers={0} onUndo={vi.fn()} />);
    const first = deferred<SaveOutcome>();
    const second = deferred<SaveOutcome>();

    act(() => {
      void track(first.promise);
      void track(second.promise);
    });
    await act(async () => first.resolve(WROTE));
    expect(toastMock.success).not.toHaveBeenCalled();

    await act(async () => second.resolve(WROTE));
    expect(toastMock.success).toHaveBeenCalledOnce();
    expect(toastMock.success.mock.calls[0][0]).toBe("Saved");
  });

  it("offers Undo only when a save the toast covers changed the dashboard", async () => {
    render(<FeedbackProbe shared otherViewers={0} onUndo={vi.fn()} />);
    const unchanged = deferred<SaveOutcome>();
    act(() => {
      void track(unchanged.promise);
    });
    await act(async () => unchanged.resolve({ changed: false }));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.dismiss).toHaveBeenCalledWith("dashboard-save:d1");

    const wrote = deferred<SaveOutcome>();
    const thenUnchanged = deferred<SaveOutcome>();
    act(() => {
      void track(wrote.promise);
      void track(thenUnchanged.promise);
    });
    await act(async () => wrote.resolve(WROTE));
    await act(async () => thenUnchanged.resolve({ changed: false }));
    expect(toastMock.success).toHaveBeenCalledOnce();
  });

  it("offers no Undo for a write that didn't say which revision it left", async () => {
    render(<FeedbackProbe shared otherViewers={0} onUndo={vi.fn()} />);
    const save = deferred<SaveOutcome>();
    act(() => {
      void track(save.promise);
    });
    await act(async () => save.resolve({ changed: true, updatedAt: "v1" }));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.dismiss).toHaveBeenCalledWith("dashboard-save:d1");
  });

  it("drops the pending toast when the newest save fails", async () => {
    render(<FeedbackProbe shared otherViewers={0} onUndo={vi.fn()} />);
    const save = deferred<SaveOutcome>();

    act(() => {
      void track(save.promise).catch(() => {});
    });
    await act(async () => save.reject(new Error("Conflict")));
    expect(toastMock.dismiss).toHaveBeenCalledWith("dashboard-save:d1");
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("keeps Saved and Undo for an earlier write when the newest save fails", async () => {
    const onUndo = vi.fn();
    render(<FeedbackProbe shared otherViewers={0} onUndo={onUndo} />);
    const wrote = deferred<SaveOutcome>();
    const failed = deferred<SaveOutcome>();

    act(() => {
      void track(wrote.promise);
      void track(failed.promise).catch(() => {});
    });
    await act(async () => wrote.resolve(WROTE));
    await act(async () => failed.reject(new Error("Conflict")));

    expect(toastMock.success).toHaveBeenCalledOnce();
    toastMock.success.mock.calls[0][1].action.onClick();
    expect(onUndo).toHaveBeenCalledExactlyOnceWith({
      revisionId: "rev1",
      updatedAt: "v1",
    });
  });

  it("keeps a newer save's toast when an earlier save fails", async () => {
    render(<FeedbackProbe shared otherViewers={0} onUndo={vi.fn()} />);
    const first = deferred<SaveOutcome>();
    const second = deferred<SaveOutcome>();

    act(() => {
      void track(first.promise).catch(() => {});
      void track(second.promise);
    });
    await act(async () => first.reject(new Error("Conflict")));
    expect(toastMock.dismiss).not.toHaveBeenCalled();

    await act(async () => second.resolve(WROTE));
    expect(toastMock.success).toHaveBeenCalledOnce();
  });

  it("closes the toast when the page stops passing a dashboard, as on leaving edit mode", async () => {
    render(<FeedbackProbe shared otherViewers={0} onUndo={vi.fn()} />);
    const save = deferred<SaveOutcome>();
    act(() => {
      void track(save.promise);
    });
    await act(async () => save.resolve(WROTE));
    expect(toastMock.success).toHaveBeenCalledOnce();

    render(
      <FeedbackProbe
        dashboardId={undefined}
        shared
        otherViewers={0}
        onUndo={vi.fn()}
      />,
    );
    expect(toastMock.dismiss).toHaveBeenCalledWith("dashboard-save:d1");
  });

  it("closes the toast on leaving its dashboard and ignores saves that land later", async () => {
    const onUndo = vi.fn();
    render(
      <FeedbackProbe
        dashboardId="d1"
        shared
        otherViewers={0}
        onUndo={onUndo}
      />,
    );
    const save = deferred<SaveOutcome>();
    act(() => {
      void track(save.promise);
    });

    render(
      <FeedbackProbe
        dashboardId="d2"
        shared
        otherViewers={0}
        onUndo={onUndo}
      />,
    );
    expect(toastMock.dismiss).toHaveBeenCalledWith("dashboard-save:d1");

    await act(async () => save.resolve(WROTE));
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
