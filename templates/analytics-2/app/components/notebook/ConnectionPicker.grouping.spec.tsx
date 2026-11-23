// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { ConnectionPicker } from "./ConnectionPicker";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("groups notebook sources by use, identifies similar names, and opens connection setup", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = vi.fn();
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <ConnectionPicker
          connections={[
            { id: "warehouse", name: "Warehouse", type: "BigQuery" },
            { id: "archive", name: "Archive" },
            { id: "other", name: "Warehouse US", type: "BigQuery" },
          ]}
          importedConnectionIds={new Set(["archive"])}
          value="warehouse"
          onSelect={select}
          addConnectionHref="/home/data?connect=1"
        />
      ),
    },
    { path: "/home/data", element: <span>Connection setup route</span> },
  ]);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <RouterProvider router={router} />
        </AgentNativeI18nProvider>,
      ),
    );
    const trigger = host.querySelector("button");
    assert(trigger);
    await act(async () => trigger.click());
    const groups = [
      ...document.querySelectorAll('[role="menu"] [role="group"]'),
    ];
    expect(
      groups.map(
        (group) =>
          document.getElementById(group.getAttribute("aria-labelledby") ?? "")
            ?.textContent,
      ),
    ).toEqual([
      "IMPORTED WORKSPACE CONNECTIONS",
      "AVAILABLE WORKSPACE CONNECTIONS",
    ]);
    const optionLabels = (group: Element | undefined) =>
      [...(group?.querySelectorAll('[role="menuitemradio"]') ?? [])].map(
        (option) => option.getAttribute("aria-label"),
      );
    expect(optionLabels(groups[0])).toEqual(["Warehouse", "Archive"]);
    expect(optionLabels(groups[1])).toEqual(["Warehouse US"]);
    const checked = document.querySelector(
      '[role="menuitemradio"][aria-checked="true"]',
    );
    expect(checked?.getAttribute("aria-label")).toBe("Warehouse");
    expect(checked?.querySelector(".nb-connection-check")).toBeTruthy();
    const add = document.querySelector<HTMLAnchorElement>('a[role="menuitem"]');
    assert(add);
    expect(add.textContent).toBe("Add a data connection");
    await act(async () => add.click());
    expect(router.state.location.pathname + router.state.location.search).toBe(
      "/home/data?connect=1",
    );
    expect(select).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
