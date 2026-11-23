// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { assert, expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { resultFieldSchema } from "../../../shared/notebook-result-contract";
import { CellOutputView } from "./CellOutputView";
import { displayTableRows } from "./useNotebookResults";

import notebookStyles from "./notebook.css?raw";

it("shows zero-based row indexes and styles cells from the result schema", () => {
  const columns = [
    ["Code", "string", "letter-case"],
    ["Revenue", "decimal", "hash"],
    ["Day", "date", "calendar"],
    ["Time", "time", "calendar"],
    ["Open", "boolean", "toggle-left"],
    ["Metadata", "json", "braces"],
  ] as const;
  const fields = columns.map(([name, type]) =>
    resultFieldSchema.parse({ fieldId: name, name, type, nullable: true }),
  );
  const output = displayTableRows(
    [
      [
        "007",
        { type: "decimal", value: "42.50" },
        "2026-11-19",
        "09:12",
        true,
        { count: 1 },
      ],
      ["008", null, null, null, false, null],
    ],
    fields,
    "2",
    false,
  );
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      <CellOutputView output={output} />
    </AgentNativeI18nProvider>,
  );

  const [indexHeader, ...headers] = host.querySelectorAll(
    'thead th[scope="col"]',
  );
  expect(indexHeader?.textContent).toContain("Row number");
  expect(
    Array.from(host.querySelectorAll('tbody tr > th[scope="row"]'), (cell) => [
      cell.textContent,
      cell.classList.contains("nb-result-row-index"),
    ]),
  ).toEqual([
    ["0", true],
    ["1", true],
  ]);
  expect(headers.map((header) => header.textContent)).toEqual(
    columns.map(([name]) => name),
  );
  for (const [index, [, , icon]] of columns.entries()) {
    const svg = headers[index]?.querySelector("svg");
    expect(svg?.classList.contains(`tabler-icon-${icon}`)).toBe(true);
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  }

  const [code, revenue] = host.querySelectorAll("tbody tr:first-child td");
  assert(code && revenue);
  expect(code.textContent).toBe("007");
  expect(revenue.textContent).toBe("42.50");
  expect(
    host.querySelector("tbody tr:nth-child(2) td:nth-of-type(2)")?.textContent,
  ).toBe("null");
  const styles = document.createElement("style");
  styles.textContent = notebookStyles;
  document.head.append(styles);
  document.body.append(host);
  try {
    expect(getComputedStyle(code).textAlign).not.toBe("right");
    expect(getComputedStyle(revenue).textAlign).toBe("right");
    expect(getComputedStyle(revenue).fontVariantNumeric).toBe("tabular-nums");
  } finally {
    host.remove();
    styles.remove();
  }
});

it("report B-KEYSCREENS-S3-FOOTER: places SQL result controls inside the single footer row with original badge and header tokens", () => {
  const fields = [
    resultFieldSchema.parse({
      fieldId: "name",
      name: "name",
      type: "string",
      nullable: true,
    }),
    resultFieldSchema.parse({
      fieldId: "value",
      name: "value",
      type: "number",
      nullable: true,
    }),
  ];
  const output = displayTableRows(
    [
      ["Alpha", 10],
      ["Beta", 20],
    ],
    fields,
    "2",
    false,
  );
  const host = document.createElement("div");
  host.className = "nb-root";
  host.innerHTML = renderToStaticMarkup(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      <div className="nb-cell-frame">
        <CellOutputView
          output={output}
          queryTableControls
          resultVariable={
            <span className="nb-result-variable">
              <button type="button" className="nb-result-variable-name">
                dataframe
              </button>
            </span>
          }
        />
      </div>
    </AgentNativeI18nProvider>,
  );

  const footer = host.querySelector(".nb-result-footer");
  assert(footer);
  expect(footer.textContent).toContain("dataframe");
  expect(footer.textContent).toContain("View");
  expect(footer.textContent).toContain("Format");
  expect(footer.textContent).toContain("Columns");
  expect(footer.textContent).toContain("Totals");
  expect(footer.textContent).toContain("2 rows");

  const styles = document.createElement("style");
  styles.textContent = notebookStyles;
  document.head.append(styles);
  document.body.append(host);
  try {
    const badge = host.querySelector<HTMLElement>(".nb-result-variable-name");
    const frame = host.querySelector<HTMLElement>(".nb-cell-frame");
    const header = host.querySelector<HTMLElement>("thead th");
    assert(badge && frame && header);
    expect(getComputedStyle(badge).borderTopLeftRadius).toBe("3px");
    expect(getComputedStyle(badge).fontSize).toBe("10px");
    expect(getComputedStyle(frame).borderTopLeftRadius).toBe("4px");
    expect(getComputedStyle(header).fontWeight).toBe("400");
  } finally {
    host.remove();
    styles.remove();
  }
});

it("report B-KEYSCREENS-S3-SYNTAX-AND-CHROME: matches original SQL syntax colors, green dataframe badge, transparent row index, and notebook chrome tokens", () => {
  const host = document.createElement("div");
  host.className = "nb-root";
  host.innerHTML = `
    <button type="button" class="nb-view-tab is-active">Notebook</button>
    <div class="nb-publish-split"><button type="button" class="nb-header-button nb-header-publish">Publish changes</button></div>
    <button type="button" class="nb-tool-rail-button">Data browser</button>
    <div class="nb-sql-editor">
      <div class="cm-editor">
        <div class="cm-content">
          <div class="cm-line cm-activeLine">
            <span class="ͼb">SELECT</span>
            <span class="ͼe">'Alpha'</span>
            <span class="ͼd">10</span>
          </div>
        </div>
      </div>
    </div>
    <table class="nb-table nb-result-grid">
      <tbody>
        <tr><th class="nb-result-row-index">0</th><td>Alpha</td></tr>
      </tbody>
    </table>
    <button type="button" class="nb-result-variable-name">dataframe</button>
    <span class="nb-chart-config-label">X-AXIS</span>
    <button type="button" class="nb-chart-type">Line</button>
    <aside class="nb-agent-pane"></aside>
  `;
  const styles = document.createElement("style");
  styles.textContent = notebookStyles;
  document.head.append(styles);
  document.body.append(host);
  try {
    const activeTab = host.querySelector<HTMLElement>(".nb-view-tab.is-active");
    const publishBtn = host.querySelector<HTMLElement>(".nb-header-publish");
    const railBtn = host.querySelector<HTMLElement>(".nb-tool-rail-button");
    const activeLine = host.querySelector<HTMLElement>(".cm-activeLine");
    const kw = host.querySelector<HTMLElement>(".ͼb");
    const str = host.querySelector<HTMLElement>(".ͼe");
    const num = host.querySelector<HTMLElement>(".ͼd");
    const rowIdx = host.querySelector<HTMLElement>(
      "tbody .nb-result-row-index",
    );
    const badge = host.querySelector<HTMLElement>(".nb-result-variable-name");
    const chartLabel = host.querySelector<HTMLElement>(
      ".nb-chart-config-label",
    );
    const chartType = host.querySelector<HTMLElement>(".nb-chart-type");
    const agentPane = host.querySelector<HTMLElement>(".nb-agent-pane");
    assert(
      activeTab &&
        publishBtn &&
        railBtn &&
        activeLine &&
        kw &&
        str &&
        num &&
        rowIdx &&
        badge &&
        chartLabel &&
        chartType &&
        agentPane,
    );
    expect(getComputedStyle(activeTab).fontWeight).toBe("400");
    expect(getComputedStyle(activeTab).paddingTop).toBe("5px");
    expect(
      getComputedStyle(publishBtn).getPropertyValue("border-start-end-radius"),
    ).toBe("0");
    expect(getComputedStyle(railBtn).paddingTop).toBe("5px");
    const rootStyle = getComputedStyle(document.documentElement);
    expect(getComputedStyle(activeLine).backgroundColor).toBe("transparent");
    expect(rootStyle.getPropertyValue("--notebook-sql-keyword").trim()).toBe(
      "218 67% 48%",
    );
    expect(rootStyle.getPropertyValue("--notebook-syntax-string").trim()).toBe(
      "354 54% 53%",
    );
    expect(rootStyle.getPropertyValue("--notebook-syntax-number").trim()).toBe(
      "175 100% 30%",
    );
    expect(
      rootStyle.getPropertyValue("--notebook-output-foreground").trim(),
    ).toBe("125 60% 34%");
    expect(
      rootStyle.getPropertyValue("--notebook-output-background").trim(),
    ).toBe("125 49% 51% / 10%");
    expect(getComputedStyle(rowIdx).backgroundColor).toBe("transparent");
    expect(getComputedStyle(badge).fontWeight).toBe("500");
    expect(getComputedStyle(chartLabel).opacity).toBe("1");
    expect(getComputedStyle(chartType).paddingTop).toBe("0px");
    expect(getComputedStyle(agentPane).paddingTop).toBe("0px");
  } finally {
    host.remove();
    styles.remove();
  }
});

it("report B-KEYSCREENS-S3-OUTPUT-SURFACE: matches original output container, footer padding, chart field radius, and cell legend styles", () => {
  const host = document.createElement("div");
  host.className = "nb-root";
  host.innerHTML = `
    <div class="nb-cell-legend">Chart 2</div>
    <div class="nb-output">
      <div class="nb-result-footer">dataframe 3 rows</div>
    </div>
    <div class="nb-chart-config-field">Y-AXIS</div>
  `;
  const styles = document.createElement("style");
  styles.textContent = notebookStyles;
  document.head.append(styles);
  document.body.append(host);
  try {
    const legend = host.querySelector<HTMLElement>(".nb-cell-legend");
    const output = host.querySelector<HTMLElement>(".nb-output");
    const footer = host.querySelector<HTMLElement>(".nb-result-footer");
    const field = host.querySelector<HTMLElement>(".nb-chart-config-field");
    assert(legend && output && footer && field);
    expect(getComputedStyle(legend).fontSize).toBe("12px");
    expect(getComputedStyle(legend).getPropertyValue("padding-inline")).toBe(
      "3px",
    );
    expect(getComputedStyle(output).borderTopLeftRadius).toBe("3px");
    expect(getComputedStyle(footer).paddingTop).toBe("0px");
    expect(getComputedStyle(footer).paddingLeft).toBe("0px");
    expect(getComputedStyle(field).borderTopLeftRadius).toBe("3px");
  } finally {
    host.remove();
    styles.remove();
  }
});
