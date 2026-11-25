// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShellCanvas } from "./app-shell.js";
import {
  READING_TIME,
  readingTimeout,
  Toaster,
  type ToastOptions,
  toast,
  toastDefaults,
  useToast,
} from "./toast.js";

afterEach(() => {
  vi.useRealTimers();
  act(() => toast.close());
  cleanup();
});

function mount(props: Partial<React.ComponentProps<typeof Toaster>> = {}) {
  return render(
    <Toaster closeLabel="Dismiss" regionLabel="Notifications" {...props} />,
  );
}

function toastElement(text: string): HTMLElement {
  const label = Array.from(
    document.querySelectorAll(".toast-title, .toast-description"),
  ).find((element) => element.textContent === text);
  const element = label?.closest(".toast");
  if (!(element instanceof HTMLElement)) throw new Error(`no toast "${text}"`);
  return element;
}

describe("Toast part", () => {
  it("raises a neutral surface toast from outside React, with its title and description", async () => {
    mount();
    act(() => {
      toast.add({ title: "Saved", description: "Your changes are live." });
    });
    const element = await waitFor(() => toastElement("Saved"));
    expect(element.dataset.variant).toBe("surface");
    expect(element.dataset.color).toBe("gray");
    expect(element.dataset.highContrast).toBeUndefined();
    expect(element.querySelector(".toast-title")?.textContent).toBe("Saved");
    expect(element.querySelector(".toast-description")?.textContent).toBe(
      "Your changes are live.",
    );
    expect(element.querySelector(".toast-icon")).toBeNull();
  });

  it("writes the status as its color, and the Toaster's variant unless the toast sets one", async () => {
    mount({ variant: "soft", highContrast: true });
    act(() => {
      toast.add({ title: "Couldn't save", color: "danger" });
      toast.add({ title: "Heads up", color: "warning", variant: "solid" });
    });
    const danger = await waitFor(() => toastElement("Couldn't save"));
    expect(danger.dataset.color).toBe("danger");
    expect(danger.dataset.variant).toBe("soft");
    expect(danger.dataset.highContrast).toBe("");
    expect(danger.querySelector(".toast-icon svg")).not.toBeNull();
    const warning = toastElement("Heads up");
    expect(warning.dataset.color).toBe("warning");
    expect(warning.dataset.variant).toBe("solid");
  });

  it("refuses a color it doesn't have instead of drawing the default", async () => {
    const options = {
      title: "Oops",
      color: "purple",
    } as unknown as ToastOptions;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    expect(() =>
      act(() => {
        toast.add(options);
      }),
    ).toThrow(/color="purple" is not one of/);
    error.mockRestore();
  });

  it("closes from its labeled close button and from the manager", async () => {
    const onClose = vi.fn();
    mount();
    let id = "";
    act(() => {
      toast.add({ title: "First", onClose });
      id = toast.add({ title: "Second" });
    });
    const close = await waitFor(() => {
      const button = toastElement("First").querySelector(".toast-close");
      if (!(button instanceof HTMLElement)) throw new Error("no close");
      return button;
    });
    expect(close.getAttribute("aria-label")).toBe("Dismiss");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
    expect(toastElement("Second")).toBeTruthy();
    act(() => toast.close(id));
    await waitFor(() => expect(screen.queryByText("Second")).toBeNull());
  });

  it("shows a Spinner while loading, then the promise's success color", async () => {
    mount();
    let resolve: (value: string) => void = () => {};
    const promise = new Promise<string>((done) => {
      resolve = done;
    });
    act(() => {
      void toast.promise(promise, {
        loading: { title: "Saving" },
        success: (name) => ({ title: `Saved ${name}` }),
        error: { title: "Couldn't save" },
      });
    });
    const loading = await waitFor(() => toastElement("Saving"));
    expect(loading.dataset.type).toBe("loading");
    expect(loading.dataset.color).toBe("gray");
    expect(loading.querySelector(".toast-icon .spinner")).not.toBeNull();
    await act(async () => {
      resolve("draft");
      await promise;
    });
    const done = await waitFor(() => toastElement("Saved draft"));
    expect(done.dataset.type).toBe("success");
    expect(done.dataset.color).toBe("success");
    expect(done.querySelector(".spinner")).toBeNull();
  });

  it("shows a rejected promise as a danger toast", async () => {
    mount();
    const promise = Promise.reject(new Error("offline"));
    await act(async () => {
      await toast
        .promise(promise, {
          loading: "Saving",
          success: "Saved",
          error: (reason) => ({
            title: reason instanceof Error ? reason.message : "Failed",
          }),
        })
        .catch(() => {});
    });
    const failed = await waitFor(() => toastElement("offline"));
    expect(failed.dataset.type).toBe("error");
    expect(failed.dataset.color).toBe("danger");
  });

  it("re-adding a loading toast's id replaces its type and color", async () => {
    mount();
    act(() => {
      toast.add({ id: "upload", title: "Uploading", type: "loading" });
    });
    await waitFor(() => toastElement("Uploading"));
    act(() => {
      toast.add({ id: "upload", title: "Uploaded", color: "success" });
    });
    const done = await waitFor(() => toastElement("Uploaded"));
    expect(done.dataset.type).toBeUndefined();
    expect(done.dataset.color).toBe("success");
    expect(done.querySelector(".spinner")).toBeNull();
  });

  it("updates in place, merging its props", async () => {
    mount();
    let id = "";
    act(() => {
      id = toast.add({ title: "Syncing", color: "info", variant: "soft" });
    });
    await waitFor(() => toastElement("Syncing"));
    act(() => toast.update(id, { title: "Synced", color: "success" }));
    const element = await waitFor(() => toastElement("Synced"));
    expect(element.dataset.color).toBe("success");
    expect(element.dataset.variant).toBe("soft");
  });

  it("renders the action and the second action from the toast's options", async () => {
    const undo = vi.fn();
    const later = vi.fn();
    mount();
    act(() => {
      toast.add({
        title: "Deleted",
        actionProps: { children: "Undo", onClick: undo },
        secondaryActionProps: { children: "Not now", onClick: later },
      });
    });
    await waitFor(() => toastElement("Deleted"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(later).toHaveBeenCalledOnce();
    const actions = toastElement("Deleted").querySelectorAll(".toast-action");
    expect(actions).toHaveLength(2);
  });

  it("announces an urgent toast as an alert", async () => {
    mount();
    act(() => {
      toast.add({ title: "Connection lost", priority: "high" });
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Connection lost",
      ),
    );
  });

  it("gives useToast() the toasts on screen inside a wrapping Toaster", async () => {
    function Count() {
      const { toasts, add } = useToast();
      return (
        <button type="button" onClick={() => add({ title: "From a hook" })}>
          {toasts.length} toasts
        </button>
      );
    }
    render(
      <Toaster closeLabel="Dismiss" regionLabel="Notifications">
        <Count />
      </Toaster>,
    );
    fireEvent.click(screen.getByRole("button", { name: "0 toasts" }));
    await waitFor(() => toastElement("From a hook"));
    expect(screen.getByRole("button", { name: "1 toasts" })).toBeTruthy();
  });

  it("shows a toast raised from a child's mount effect, before the Toaster subscribes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    function Early({ title }: { title: string }) {
      React.useEffect(() => {
        toast.add({ title });
      }, [title]);
      return null;
    }
    render(
      <>
        <Early title="Before the sibling" />
        <Toaster closeLabel="Dismiss" regionLabel="Notifications">
          <Early title="Inside the Toaster" />
        </Toaster>
      </>,
    );
    await waitFor(() => toastElement("Before the sibling"));
    expect(toastElement("Inside the Toaster")).toBeTruthy();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports a toast raised with no Toaster once, and shows it when one mounts", async () => {
    vi.resetModules();
    const fresh = await import("./toast.js");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fresh.toast.add({ title: "Nobody listening" });
    fresh.toast.add({ title: "Still nobody" });
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain(
      "Mount <Toaster> at the app root",
    );
    error.mockRestore();
    render(<fresh.Toaster closeLabel="Dismiss" regionLabel="Notifications" />);
    await waitFor(() => toastElement("Nobody listening"));
    act(() => fresh.toast.close());
  });
});

describe("Toast policy", () => {
  it("gives a toast its reading time: 6s, 60ms a character, at most 15s", () => {
    expect(READING_TIME).toEqual({
      minimum: 6000,
      perCharacter: 60,
      maximum: 15000,
    });
    expect(readingTimeout("Saved")).toBe(6300);
    expect(readingTimeout("Saved", "Your design is up to date.")).toBe(
      6000 + 31 * 60,
    );
    expect(
      readingTimeout(
        <>
          Moved to <strong>Archive</strong>
        </>,
      ),
    ).toBe(6000 + 16 * 60);
    expect(readingTimeout("x".repeat(1000))).toBe(15000);
  });

  it("keeps danger and actionable toasts until dismissed, and announces only danger assertively", () => {
    expect(toastDefaults({ title: "Saved" })).toEqual({
      timeout: 6300,
      priority: "low",
    });
    expect(toastDefaults({ title: "Saved", color: "success" }).priority).toBe(
      "low",
    );
    expect(toastDefaults({ title: "Heads up", color: "warning" })).toEqual({
      timeout: readingTimeout("Heads up"),
      priority: "low",
    });
    expect(toastDefaults({ title: "Couldn't save", color: "danger" })).toEqual({
      timeout: 0,
      priority: "high",
    });
    expect(toastDefaults({ title: "Failed", type: "error" })).toEqual({
      timeout: 0,
      priority: "high",
    });
    expect(
      toastDefaults({ title: "Deleted", actionProps: { children: "Undo" } }),
    ).toEqual({ timeout: 0, priority: "low" });
    expect(
      toastDefaults({
        title: "Update ready",
        secondaryActionProps: { children: "Not now" },
      }).timeout,
    ).toBe(0);
  });
});

describe("Toaster timing and announcements", () => {
  function tick(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("closes a plain toast after its reading time, not before", () => {
    vi.useFakeTimers();
    mount();
    const onClose = vi.fn();
    act(() => {
      toast.add({ title: "Saved", onClose });
    });
    tick(readingTimeout("Saved") - 1);
    expect(onClose).not.toHaveBeenCalled();
    tick(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a danger toast and a toast with an action until dismissed", () => {
    vi.useFakeTimers();
    mount();
    const dangerClosed = vi.fn();
    const actionClosed = vi.fn();
    act(() => {
      toast.add({
        title: "Couldn't save",
        color: "danger",
        onClose: dangerClosed,
      });
      toast.add({
        title: "Deleted",
        actionProps: { children: "Undo" },
        onClose: actionClosed,
      });
    });
    tick(120000);
    expect(dangerClosed).not.toHaveBeenCalled();
    expect(actionClosed).not.toHaveBeenCalled();
  });

  it("lets an explicit timeout and priority win", () => {
    vi.useFakeTimers();
    mount();
    const onClose = vi.fn();
    act(() => {
      toast.add({
        title: "Couldn't save",
        color: "danger",
        timeout: 1000,
        priority: "low",
        onClose,
      });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    tick(1001);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a rejected promise's toast, announced assertively", async () => {
    vi.useFakeTimers();
    mount();
    const promise = Promise.reject(new Error("offline"));
    await act(async () => {
      await toast
        .promise(promise, {
          loading: { title: "Saving" },
          success: { title: "Saved" },
          error: { title: "Couldn't save" },
        })
        .catch(() => undefined);
    });
    tick(120000);
    expect(toastElement("Couldn't save").dataset.color).toBe("danger");
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
  });

  it("announces neutral, success, info and warning toasts politely", () => {
    mount();
    act(() => {
      toast.add({ title: "Copied" });
      toast.add({ title: "Saved", color: "success" });
      toast.add({ title: "Syncing", color: "info" });
      toast.add({ title: "Two files skipped", color: "warning" });
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen
        .getByRole("region", { name: "Notifications" })
        .getAttribute("aria-live"),
    ).toBe("polite");
  });

  it("names the region from the caller, and F6 moves focus into it", () => {
    render(<Toaster closeLabel="Schließen" regionLabel="Benachrichtigungen" />);
    act(() => {
      toast.add({ title: "Gespeichert" });
    });
    const region = screen.getByRole("region", { name: "Benachrichtigungen" });
    expect(region.getAttribute("aria-keyshortcuts")).toBe("F6");
    fireEvent.keyDown(window, { key: "F6" });
    expect(document.activeElement).toBe(region);
  });

  it("pauses its timer while the pointer is over the region", () => {
    vi.useFakeTimers();
    mount();
    const onClose = vi.fn();
    act(() => {
      toast.add({ title: "Saved", timeout: 1000, onClose });
    });
    fireEvent.mouseEnter(screen.getByRole("region", { name: "Notifications" }));
    tick(5000);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("pauses its timer while focus is in the region", () => {
    vi.useFakeTimers();
    mount();
    const onClose = vi.fn();
    act(() => {
      toast.add({ title: "Copied", timeout: 1000, onClose });
    });
    fireEvent.keyDown(window, { key: "F6" });
    tick(5000);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("makes the close and action buttons 24px targets", () => {
    mount();
    act(() => {
      toast.add({ title: "Deleted", actionProps: { children: "Undo" } });
    });
    const element = toastElement("Deleted");
    expect(
      element.querySelector<HTMLElement>(".toast-close")?.dataset.size,
    ).toBe("md");
    expect(
      element.querySelector<HTMLElement>(".toast-action")?.dataset.size,
    ).toBe("md");
  });

  it("shows at most three toasts by default", () => {
    mount();
    act(() => {
      for (const title of ["One", "Two", "Three", "Four"]) toast.add({ title });
    });
    expect(toastElement("One").hasAttribute("data-limited")).toBe(true);
    expect(toastElement("Four").hasAttribute("data-limited")).toBe(false);
  });
});

describe("Toaster placement", () => {
  function portalOf(text: string): HTMLElement {
    const portal = toastElement(text).closest(".toast-portal");
    if (!(portal instanceof HTMLElement)) throw new Error("no portal");
    return portal;
  }

  it("renders inside the container element it's given", () => {
    const canvas = document.createElement("div");
    document.body.append(canvas);
    render(
      <Toaster
        closeLabel="Dismiss"
        regionLabel="Notifications"
        container={canvas}
      />,
    );
    act(() => {
      toast.add({ title: "In the canvas" });
    });
    expect(canvas.contains(toastElement("In the canvas"))).toBe(true);
    expect(portalOf("In the canvas").hasAttribute("data-anchored")).toBe(true);
    canvas.remove();
  });

  it("commits new bounds only when scrolling changes the visible canvas", async () => {
    const canvas = document.createElement("div");
    document.body.append(canvas);
    const commits = vi.fn();
    let top = 20;
    const measure = vi
      .spyOn(canvas, "getBoundingClientRect")
      .mockImplementation(() => new DOMRect(10, top, 200, 100));
    const scroll = async () => {
      await act(async () => {
        window.dispatchEvent(new Event("scroll"));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      });
    };
    try {
      render(
        <React.Profiler id="notifications" onRender={commits}>
          <Toaster
            container={canvas}
            closeLabel="Dismiss"
            regionLabel="Notifications"
          />
        </React.Profiler>,
      );
      const portal = canvas.querySelector<HTMLElement>(".toast-portal");
      expect(portal?.style.top).toBe("20px");
      commits.mockClear();
      measure.mockClear();
      await scroll();
      expect(measure).toHaveBeenCalled();
      expect(commits).not.toHaveBeenCalled();
      top = -20;
      await scroll();
      expect(portal?.style.top).toBe("0px");
      expect(portal?.style.height).toBe("80px");
    } finally {
      canvas.remove();
    }
  });

  it("renders inside a container ref", () => {
    function Editor() {
      const canvas = React.useRef<HTMLDivElement>(null);
      return (
        <>
          <div data-testid="canvas" ref={canvas} />
          <Toaster
            closeLabel="Dismiss"
            regionLabel="Notifications"
            container={canvas}
          />
        </>
      );
    }
    render(<Editor />);
    act(() => {
      toast.add({ title: "By ref" });
    });
    expect(screen.getByTestId("canvas").contains(toastElement("By ref"))).toBe(
      true,
    );
  });

  it("resolves an enclosing canvas ref after the canvas mounts", () => {
    const canvas = React.createRef<HTMLDivElement>();
    render(
      <div ref={canvas}>
        <Toaster
          closeLabel="Dismiss"
          regionLabel="Notifications"
          container={canvas}
        />
      </div>,
    );
    expect(
      canvas.current?.querySelector(".toast-portal[data-anchored]"),
    ).toBeTruthy();
  });

  it("anchors in a canvas owned by another document", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const canvas = frame.contentDocument?.body;
      if (!canvas) throw new Error("Missing frame document");
      const view = mount({ container: canvas });
      expect(canvas.querySelector(".toast-portal[data-anchored]")).toBeTruthy();
      view.unmount();
    } finally {
      frame.remove();
    }
  });

  it("sits in the App Shell canvas with no container given", () => {
    render(
      <>
        <Toaster closeLabel="Dismiss" regionLabel="Notifications" />
        <AppShellCanvas data-testid="canvas" />
      </>,
    );
    act(() => {
      toast.add({ title: "Anchored" });
    });
    expect(
      screen.getByTestId("canvas").contains(toastElement("Anchored")),
    ).toBe(true);
  });

  it("falls back to the window's corner with no anchor", () => {
    mount();
    act(() => {
      toast.add({ title: "Cornered" });
    });
    const portal = portalOf("Cornered");
    expect(portal.parentElement).toBe(document.body);
    expect(portal.hasAttribute("data-anchored")).toBe(false);
  });
});
