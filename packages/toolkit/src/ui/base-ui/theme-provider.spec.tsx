import { useDirection } from "@base-ui/react/direction-provider";
// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

import { Dialog, DialogPopup, DialogTitle } from "./dialog.js";
import { ThemeProvider } from "./theme-provider.js";

afterEach(cleanup);

it("hydrates the server-rendered region and forwards its root ref as the theme changes", () => {
  const ref = React.createRef<HTMLDivElement>();
  const frame = (appearance: "light" | "dark") => (
    <ThemeProvider appearance={appearance} radius="small">
      <ThemeProvider
        ref={ref}
        appTheme="slides"
        render={<section aria-label="Preview" />}
        className="preview"
      >
        Slide
      </ThemeProvider>
    </ThemeProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(frame("dark"));
  const region = container.querySelector("section");
  expect(region?.getAttribute("data-app-theme")).toBe("slides");
  expect(region?.closest("[data-radius]")).toBe(region?.parentElement);
  expect(region?.parentElement?.getAttribute("data-radius")).toBe("small");
  expect(region?.closest(".dark")).toBe(region?.parentElement);
  expect(region?.classList.contains("preview")).toBe(true);
  document.body.append(container);
  const view = render(frame("dark"), { container, hydrate: true });
  expect(ref.current).toBe(region);
  act(() => view.rerender(frame("light")));
  expect(ref.current).toBe(region);
  expect(region?.closest(".light")).toBe(region?.parentElement);
  expect(region?.classList.contains("dark")).toBe(false);
});

it("mounts an initially open popup in the nearest region on the first render", async () => {
  const region = React.createRef<HTMLDivElement>();
  render(
    <ThemeProvider appearance="light">
      <ThemeProvider appearance="dark" ref={region}>
        <Dialog defaultOpen>
          <DialogPopup aria-describedby={undefined}>
            <DialogTitle>Settings</DialogTitle>
          </DialogPopup>
        </Dialog>
      </ThemeProvider>
    </ThemeProvider>,
  );
  const popup = await screen.findByRole("dialog", { name: "Settings" });
  expect(region.current?.contains(popup)).toBe(true);
});

it("updates appearance across nested regions without rerendering direction consumers", () => {
  let renders = 0;
  const Item = React.memo(() => {
    const direction = useDirection();
    renders++;
    return <span data-direction={direction} />;
  });
  const items = Array.from({ length: 128 }, (_, i) => <Item key={i} />);
  const frame = (appearance: "light" | "dark", dir: "ltr" | "rtl") => (
    <ThemeProvider appearance={appearance} dir={dir}>
      <ThemeProvider density="compact">{items}</ThemeProvider>
    </ThemeProvider>
  );
  const { container, rerender } = render(frame("light", "ltr"));
  const first = container.querySelector("[data-direction]");
  renders = 0;
  rerender(frame("dark", "ltr"));
  expect(first?.closest(".dark")).toBe(container.firstElementChild);
  expect(renders).toBe(0);
  rerender(frame("dark", "rtl"));
  expect(container.querySelectorAll('[data-direction="rtl"]')).toHaveLength(
    128,
  );
  expect(container.querySelector("[data-direction]")).toBe(first);
});

it("inherits during SSR and tracks device appearance only while requested", () => {
  let dark = true;
  const events = new EventTarget();
  const addEventListener = vi.spyOn(events, "addEventListener");
  const removeEventListener = vi.spyOn(events, "removeEventListener");
  const query = Object.defineProperty(events, "matches", { get: () => dark });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  try {
    const frame = (appearance: "system" | "light", preview = appearance) => (
      <ThemeProvider appearance="light">
        <ThemeProvider
          appearance={appearance}
          render={<section aria-label="Tools" />}
        />
        <ThemeProvider appearance={preview} data-testid="preview" />
      </ThemeProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(frame("system"));
    const section = container.querySelector("section");
    expect(section?.closest(".light")).toBe(container.firstElementChild);
    const view = render(frame("system"), { container, hydrate: true });
    expect(view.getByRole("region")).toBe(section);
    expect(section?.classList.contains("dark")).toBe(true);
    expect(view.getByTestId("preview").classList.contains("dark")).toBe(true);
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    dark = false;
    act(() => {
      events.dispatchEvent(new Event("change"));
    });
    expect(section?.classList.contains("light")).toBe(true);
    expect(view.getByTestId("preview").classList.contains("light")).toBe(true);
    view.rerender(frame("light", "system"));
    expect(removeEventListener).not.toHaveBeenCalled();
    dark = true;
    act(() => {
      events.dispatchEvent(new Event("change"));
    });
    expect(section?.classList.contains("light")).toBe(true);
    expect(view.getByTestId("preview").classList.contains("dark")).toBe(true);
    view.rerender(frame("light"));
    expect(removeEventListener).toHaveBeenCalledWith(
      "change",
      addEventListener.mock.calls[0][1],
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps an open dialog on its host window's appearance when another window has a different preference", async () => {
  function previewWindow(initiallyDark: boolean) {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const win = frame.contentWindow;
    const body = frame.contentDocument?.body;
    if (!win || !body) throw new Error("Expected a preview document");
    let dark = initiallyDark;
    const query = Object.defineProperty(new EventTarget(), "matches", {
      get: () => dark,
    });
    Object.defineProperty(win, "matchMedia", { value: () => query });
    const container = body.appendChild(document.createElement("div"));
    return {
      frame,
      container,
      change(darkMode: boolean) {
        dark = darkMode;
        act(() => {
          query.dispatchEvent(new Event("change"));
        });
      },
    };
  }
  const workspace = previewWindow(false);
  const inspector = previewWindow(true);
  try {
    const main = render(
      <ThemeProvider appearance="system">Workspace</ThemeProvider>,
      {
        container: workspace.container,
      },
    );
    const panel = render(
      <ThemeProvider appearance="system">
        <Dialog defaultOpen>
          <DialogPopup aria-describedby={undefined}>
            <DialogTitle>Inspector</DialogTitle>
          </DialogPopup>
        </Dialog>
      </ThemeProvider>,
      { container: inspector.container },
    );
    const dialog = await panel.findByRole("dialog", { name: "Inspector" });
    const surface = panel.container.firstElementChild;
    expect(dialog.closest(".dark")).toBe(surface);
    expect(main.container.firstElementChild?.classList.contains("light")).toBe(
      true,
    );
    workspace.change(true);
    expect(main.container.firstElementChild?.classList.contains("dark")).toBe(
      true,
    );
    inspector.change(false);
    expect(dialog.closest(".light")).toBe(surface);
    expect(panel.getByRole("dialog")).toBe(dialog);
    expect(main.container.firstElementChild?.classList.contains("dark")).toBe(
      true,
    );
  } finally {
    cleanup();
    workspace.frame.remove();
    inspector.frame.remove();
  }
});
