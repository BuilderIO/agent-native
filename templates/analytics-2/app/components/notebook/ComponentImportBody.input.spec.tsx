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
          kind: "input",
          label: null,
          contents: {
            kind: "input",
            name: "region",
            inputType: "text",
            defaultValueString: "EMEA",
          },
        },
      ],
    },
    isPending: false,
    error: null,
  }),
}));
const { ComponentImportBody } = await import("./ComponentImportBody");

it("report QA-1795079397 a captured input shows its name and value, not an empty-result note", async () => {
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
          <ComponentImportBody componentId="c1" title="Filters" />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(mount.textContent).toContain("region");
    expect(mount.textContent).toContain("EMEA");
    expect(mount.textContent).not.toContain("captured no result");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
  }
});
