// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

// The Environment tab lists the packages the notebook's Python runtime can
// import, with versions, and filters them. It names the runtime it is
// describing rather than implying a per-project kernel.
const data = {
  runtime: "Pyodide",
  runtimeVersion: "314.0.7",
  packages: [
    { name: "micropip", version: "0.11.1" },
    { name: "pandas", version: "2.3.0" },
  ],
};

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data, isPending: false, error: null }),
}));

const { ProjectEnvironmentPanel } = await import("./ProjectEnvironmentPanel");

it("lists the runtime's packages with versions and filter", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <ProjectEnvironmentPanel language="python" onClose={() => {}} />
      </AgentNativeI18nProvider>,
    ),
  );

  const panel = container.querySelector('aside[aria-label="Environment"]');
  expect(panel).not.toBeNull();
  expect(
    [...container.querySelectorAll("h3")].map((heading) => heading.textContent),
  ).toEqual([
    "Compute profile",
    "Project timezone",
    "SQL caching",
    "Cell execution order",
    "Git packages",
    "Pre-installed packages",
  ]);
  const unavailableFields = [...container.querySelectorAll("dt")].map(
    (label) => [label.textContent, label.nextElementSibling?.textContent],
  );
  expect(unavailableFields).toEqual([
    ["Image", "Unavailable"],
    ["Size", "Unavailable"],
    ["Idle timeout", "Unavailable"],
    ["Timezone", "Unavailable"],
    ["Use cached results when developing logic", "Unavailable"],
    ["Rerun queries if results are older than:", "Unavailable"],
    ["Allow execution reordering", "Unavailable"],
  ]);
  expect(
    [...container.querySelectorAll("th")].map((heading) => heading.textContent),
  ).toEqual(["Name", "Version"]);
  expect(panel!.textContent).toContain("Runtime: Pyodide 314.0.7");
  const rows = [...container.querySelectorAll(".nb-package-row")].map((row) =>
    row.textContent?.replace(/\s+/g, ""),
  );
  expect(rows).toEqual(["micropip0.11.1", "pandas2.3.0"]);

  const filter = container.querySelector(
    'input[aria-label="Filter packages"]',
  ) as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(filter, "pan");
    filter.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect([...container.querySelectorAll(".nb-package-row")].length).toBe(1);
  act(() => root.unmount());
  container.remove();
});
