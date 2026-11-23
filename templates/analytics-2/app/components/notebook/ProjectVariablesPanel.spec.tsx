import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { ProjectVariablesPanel } from "./ProjectVariablesPanel";

const variables = [
  {
    cellId: "cell_1",
    name: "dataframe",
    cellLabel: "SQL 1",
    kind: "sql",
    rows: 120,
    columns: 4,
  },
  {
    cellId: "cell_2",
    name: "total",
    cellLabel: "SQL 2",
    kind: "sql",
    rows: 1,
    columns: 1,
  },
];

describe("ProjectVariablesPanel", () => {
  it("lists each result variable with its shape and owning cell", () => {
    const html = renderToStaticMarkup(
      <AgentNativeI18nProvider catalog={{ messages: enUS }}>
        <ProjectVariablesPanel
          variables={variables}
          onClose={() => {}}
          onJump={() => {}}
        />
      </AgentNativeI18nProvider>,
    );
    expect(html).toContain("Variables");
    expect(html).toContain("dataframe");
    expect(html).toContain("120 rows × 4 cols");
    expect(html).toContain("1 row × 1 col");
    expect(html).toContain("SQL 1");
  });

  it("shows the empty state when no cell has produced a variable", () => {
    const html = renderToStaticMarkup(
      <AgentNativeI18nProvider catalog={{ messages: enUS }}>
        <ProjectVariablesPanel
          variables={[]}
          onClose={() => {}}
          onJump={() => {}}
        />
      </AgentNativeI18nProvider>,
    );
    expect(html).toContain("No variables yet");
  });
});
