// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { i18nCatalog } from "../../../i18n";
import {
  DashboardSaveStatus,
  otherViewerCount,
  useDashboardSaveFeedback,
  type DashboardSaveState,
} from "./DashboardSaveStatus";

const toastMock = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const ME = "me@example.com";

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>{node}</TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
}

function statusText(): string {
  const status = container.querySelector('[role="status"]');
  if (!status) throw new Error("save status not rendered");
  return status.textContent ?? "";
}

let feedback: ReturnType<typeof useDashboardSaveFeedback>;
function FeedbackProbe(props: {
  shared: boolean;
  otherViewers: number;
  onUndo: () => void;
}) {
  feedback = useDashboardSaveFeedback({ dashboardId: "d1", ...props });
  return (
    <DashboardSaveStatus
      state={feedback.state}
      shared={props.shared}
      updatedAt={null}
      updatedBy={null}
      currentUserEmail={ME}
    />
  );
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

describe("DashboardSaveStatus", () => {
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

  it("says who a saved shared dashboard is saved for, and who saved it", () => {
    const renderSaved = (updatedBy: string, shared: boolean) =>
      render(
        <DashboardSaveStatus
          state={{ status: "saved" }}
          shared={shared}
          updatedAt={new Date().toISOString()}
          updatedBy={updatedBy}
          currentUserEmail={ME}
        />,
      );

    renderSaved(ME, true);
    expect(statusText()).toMatch(/^Saved for everyone· .+· you$/);

    renderSaved("bob@example.com", false);
    expect(statusText()).toMatch(/^Saved· .+· Bob$/);
  });

  it("shows saving and failed states", () => {
    const renderState = (state: DashboardSaveState) =>
      render(
        <DashboardSaveStatus
          state={state}
          shared
          updatedAt={null}
          updatedBy={null}
          currentUserEmail={ME}
        />,
      );

    renderState({ status: "saving" });
    expect(statusText()).toBe("Saving for everyone…");

    renderState({ status: "failed", message: "Conflict" });
    expect(statusText()).toBe("Couldn't save");
  });

  it("turns one toast from saving into saved, with the viewer count and Undo", async () => {
    const onUndo = vi.fn();
    render(<FeedbackProbe shared otherViewers={2} onUndo={onUndo} />);
    const save = deferred<{ isLatest: boolean }>();

    act(() => {
      void feedback.track(save.promise);
    });
    expect(statusText()).toBe("Saving for everyone…");
    expect(toastMock.loading).toHaveBeenCalledWith("Saving for everyone…", {
      id: "dashboard-save:d1",
    });

    await act(async () => save.resolve({ isLatest: true }));
    expect(statusText()).toMatch(/^Saved for everyone/);
    const [message, options] = toastMock.success.mock.calls[0];
    expect(message).toBe("Saved for everyone");
    expect(options).toMatchObject({
      id: "dashboard-save:d1",
      description: "2 others have it open",
      action: { label: "Undo" },
    });
    options.action.onClick();
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("names the change in the saved toast", async () => {
    const widened = {
      kind: "column-resized" as const,
      title: "Signups by Template",
      columns: 1,
      direction: "wider" as const,
    };
    const saveWith = async (
      changes: Parameters<typeof feedback.track>[1],
    ): Promise<string> => {
      toastMock.success.mockClear();
      const save = deferred<{ isLatest: boolean }>();
      act(() => {
        void feedback.track(save.promise, changes);
      });
      await act(async () => save.resolve({ isLatest: true }));
      return toastMock.success.mock.calls[0][0];
    };

    render(<FeedbackProbe shared otherViewers={0} onUndo={vi.fn()} />);
    await expect(saveWith([widened])).resolves.toBe(
      "Widened a column in “Signups by Template” · Saved for everyone",
    );

    render(<FeedbackProbe shared={false} otherViewers={0} onUndo={vi.fn()} />);
    await expect(
      saveWith([widened, { kind: "layout-changed" }, { kind: "other" }]),
    ).resolves.toBe(
      "Widened a column in “Signups by Template” +2 more · Saved",
    );
    await expect(saveWith([])).resolves.toBe("Saved");
  });

  it("leaves the toast pending while a newer save is queued", async () => {
    render(<FeedbackProbe shared={false} otherViewers={0} onUndo={vi.fn()} />);
    const save = deferred<{ isLatest: boolean }>();

    act(() => {
      void feedback.track(save.promise);
    });
    await act(async () => save.resolve({ isLatest: false }));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(statusText()).toBe("Saving…");
  });

  it("drops the pending toast and shows the failure when a save fails", async () => {
    render(<FeedbackProbe shared otherViewers={0} onUndo={vi.fn()} />);
    const save = deferred<{ isLatest: boolean }>();

    act(() => {
      void feedback.track(save.promise).catch(() => {});
    });
    await act(async () => save.reject(new Error("Conflict")));
    expect(toastMock.dismiss).toHaveBeenCalledWith("dashboard-save:d1");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(statusText()).toBe("Couldn't save");
  });
});
