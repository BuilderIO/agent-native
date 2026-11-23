// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import enUS from "@/i18n/en-US";

import { CellOutputView, formatPublishedValue } from "./CellOutputView";

// SQL NUMERIC arrives as a string. Converting it with Number() before Intl
// rounds anything past 2^53, so the displayed digits must come from the text.
it("renders a configured NUMERIC cell with its exact digits and title", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          output={{
            type: "table",
            columns: [
              { name: "balance", type: "string" },
              { name: "price", type: "string" },
            ],
            rows: [["9007199254740993", "9007199254740993.129"]],
            rowCount: 1,
            truncated: false,
          }}
          columnFormats={["number", "currency"]}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const cells = [...container.querySelectorAll("tbody td")];
  expect(cells.map((cell) => cell.textContent)).toEqual([
    "9,007,199,254,740,993",
    "$9,007,199,254,740,993.13",
  ]);
  expect(cells.map((cell) => cell.getAttribute("title"))).toEqual([
    "9,007,199,254,740,993",
    "$9,007,199,254,740,993.13",
  ]);
  await act(async () => root.unmount());
  container.remove();
});

const exactCases: [
  string,
  unknown,
  Parameters<typeof formatPublishedValue>[1],
  string,
  string,
][] = [
  [
    "unsafe integer",
    "9007199254740993",
    "number",
    "en-US",
    "9,007,199,254,740,993",
  ],
  [
    "unsafe negative",
    "-9007199254740993",
    "number",
    "en-US",
    "-9,007,199,254,740,993",
  ],
  [
    "unsafe currency",
    "9007199254740993",
    "currency",
    "en-US",
    "$9,007,199,254,740,993.00",
  ],
  [
    "unsafe percent",
    "9007199254740993",
    "percent",
    "en-US",
    "900,719,925,474,099,300.00%",
  ],
  [
    "unsafe fraction",
    "9007199254740992.5",
    "currency",
    "en-US",
    "$9,007,199,254,740,992.50",
  ],
  [
    "fraction rounds to three digits",
    "12345.6789",
    "number",
    "en-US",
    "12,345.679",
  ],
  ["negative fraction", "-0.0005", "number", "en-US", "-0.001"],
  ["currency rounds to cents", "1.005", "currency", "en-US", "$1.01"],
  ["scientific", "1.5e3", "number", "en-US", "1,500"],
  [
    "scientific uppercase negative exponent",
    "-2.5E-2",
    "percent",
    "en-US",
    "-2.50%",
  ],
  [
    "large scientific",
    "1e21",
    "number",
    "en-US",
    "1,000,000,000,000,000,000,000",
  ],
  ["percent", "0.125", "percent", "en-US", "12.50%"],
  ["padded text", " 1234 ", "number", "en-US", "1,234"],
  ["compact below threshold", "999", "compact_number", "en-US", "999"],
  ["compact boundary", "999999", "compact_number", "en-US", "1M"],
  ["compact", "1234567", "compact_number", "en-US", "1.2M"],
  ["de-DE number", "1234567.891", "number", "de-DE", "1.234.567,891"],
  [
    "de-DE unsafe",
    "9007199254740993",
    "number",
    "de-DE",
    "9.007.199.254.740.993",
  ],
  ["de-DE currency", "1234.5", "currency", "de-DE", "1.234,50 $"],
  ["number value", 1234.5, "number", "en-US", "1,234.5"],
  [
    "bigint value",
    9007199254740993n,
    "number",
    "en-US",
    "9,007,199,254,740,993",
  ],
];

it.each(exactCases)(
  "formats %s exactly",
  (_name, value, format, locale, expected) => {
    expect(formatPublishedValue(value, format, locale)).toBe(expected);
  },
);

const fallbackCases: [string, unknown, string][] = [
  ["words", "abc", "abc"],
  ["blank", "", ""],
  ["whitespace", "  ", "  "],
  ["boolean", true, "true"],
  ["object", { amount: 1 }, '{"amount":1}'],
  ["array", [1], "[1]"],
  ["NaN text", "NaN", "NaN"],
  ["Infinity text", "Infinity", "Infinity"],
  ["hexadecimal text", "0x10", "0x10"],
  ["trailing text", "12abc", "12abc"],
  ["grouped text", "1,234", "1,234"],
  ["non-finite number", Number.POSITIVE_INFINITY, "Infinity"],
  ["overflowing exponent", "1e999999", "1e999999"],
  ["negative overflowing exponent", "-1e999999", "-1e999999"],
];

it.each(fallbackCases)(
  "keeps %s as normal text under a numeric format",
  (_name, value, expected) => {
    for (const format of [
      "number",
      "percent",
      "currency",
      "compact_number",
    ] as const) {
      expect(formatPublishedValue(value, format, "en-US")).toBe(expected);
    }
  },
);

it("leaves text and date formats unchanged", () => {
  expect(formatPublishedValue("9007199254740993", "text", "en-US")).toBe(
    "9007199254740993",
  );
  expect(formatPublishedValue("9007199254740993", null, "en-US")).toBe(
    "9007199254740993",
  );
  expect(formatPublishedValue("2026-01-02", "date", "en-US")).toBe("1/2/2026");
  expect(formatPublishedValue("not a date", "date", "en-US")).toBe(
    "not a date",
  );
  expect(formatPublishedValue(null, "number", "en-US")).toBe("");
});
