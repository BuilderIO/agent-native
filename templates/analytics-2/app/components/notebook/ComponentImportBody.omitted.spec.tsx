// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

const cells = [
  {
    id: "c1",
    kind: "sql",
    label: "Orders",
    contents: {},
    outputOmitted: true,
  },
  { id: "c2", kind: "sql", label: "Empty", contents: {} },
];

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: { component: { id: "k", name: "K", cellCount: 2 }, cells },
    isPending: false,
    error: null,
  }),
}));

const { ComponentImportBody } = await import("./ComponentImportBody");

it("tells the reader a result is hidden for access, and keeps that apart from a cell that captured none", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <ComponentImportBody componentId="k" title={null} />
        </AgentNativeI18nProvider>,
      ),
    );
    const blocks = [...mount.querySelectorAll(".nb-component-cell")].map(
      (block) => block.textContent,
    );
    expect(blocks[0]).toContain("you can't read the data it came from");
    expect(blocks[1]).toContain("This cell captured no result.");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
