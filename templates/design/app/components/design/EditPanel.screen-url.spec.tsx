// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderUrlInspector(props: {
  onScreenUrlChange?: (screenId: string, url: string) => void;
}) {
  act(() =>
    root.render(
      <EditPanel
        selectedElement={null}
        selectedScreenGeometry={{
          id: "screen-1",
          title: "Students",
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
        }}
        selectedScreenSource={{
          sourceType: "url",
          url: "http://localhost:5173/students",
          connectionId: "localhost-1",
        }}
        viewMode="overview"
        mode="edit"
        onStyleChange={vi.fn()}
        readOnly={false}
        {...props}
      />,
    ),
  );
}

it("lets a live-screen editor update only the URL", async () => {
  const onScreenUrlChange = vi.fn();
  renderUrlInspector({ onScreenUrlChange });

  const url = container.querySelector<HTMLInputElement>(
    'input[aria-label="editPanel.screenSource.urlLabel"]',
  );
  const update = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "editPanel.screenSource.update",
  );
  expect(url?.disabled).toBe(false);
  expect(update?.disabled).toBe(false);

  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(url, "http://localhost:5173/students?filter=active");
    url!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => url!.blur());
  expect(onScreenUrlChange).not.toHaveBeenCalled();
  await act(() => update!.click());

  expect(onScreenUrlChange).toHaveBeenCalledTimes(1);
  expect(onScreenUrlChange).toHaveBeenCalledWith(
    "screen-1",
    "http://localhost:5173/students?filter=active",
  );
  const sourceTabs = Array.from(
    container.querySelectorAll('[role="tab"]'),
  ).filter((tab) =>
    ["editPanel.positionOptions.static", "editPanel.screenSource.url"].includes(
      tab.textContent ?? "",
    ),
  );
  expect(sourceTabs).toHaveLength(2);
  expect(sourceTabs.every((tab) => (tab as HTMLButtonElement).disabled)).toBe(
    true,
  );
});

it("keeps live URL controls disabled without the URL permission", () => {
  renderUrlInspector({});
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="editPanel.screenSource.urlLabel"]',
    )?.disabled,
  ).toBe(true);
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editPanel.screenSource.update",
    )?.disabled,
  ).toBe(true);
});
