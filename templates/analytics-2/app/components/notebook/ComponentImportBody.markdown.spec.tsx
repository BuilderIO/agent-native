// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: {
      cells: [
        {
          id: "1",
          kind: "markdown",
          label: null,
          contents: {
            kind: "markdown",
            markdown: "# Revenue\n\n- EMEA\n- APAC",
          },
        },
      ],
    },
    isPending: false,
    error: null,
  }),
}));
const { ComponentImportBody } = await import("./ComponentImportBody");

it("report QA-1795079397 a placed component renders its markdown cells as formatted content", async () => {
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
          <ComponentImportBody componentId="c1" title="Report" />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(mount.querySelector(".nb-md-h1")?.textContent).toBe("Revenue");
    expect(mount.querySelectorAll("li")).toHaveLength(2);
    expect(mount.textContent).not.toContain("# Revenue");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
