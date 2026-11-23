// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { DisplayFilterRows } from "./DisplayFilterRows";

describe("DisplayFilterRows list trigger", () => {
  it("truncates a long selected-value summary and exposes it as a title", () => {
    const long = "ünïcode-".repeat(40);
    const html = renderToStaticMarkup(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <DisplayFilterRows
          columns={[{ name: "name", type: "string" }]}
          rows={[[long]]}
          filters={[
            {
              id: 1,
              column: 0,
              operator: "one_of",
              value: "",
              end: "",
              values: [long],
            },
          ]}
          onChange={() => {}}
          onAdd={() => {}}
        />
      </AgentNativeI18nProvider>,
    );
    expect(html).toContain("max-w-56");
    expect(html).toContain("truncate");
    expect(html).toContain(`title="${long}"`);
  });
});
