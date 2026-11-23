// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import enUS from "@/i18n/en-US";

import { CellOutputView } from "./CellOutputView";

it("report FLOW-download-csv: offers a download only when the complete result is loaded", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const output = {
    type: "table" as const,
    columns: [{ name: "name", type: "string" as const }],
    rows: [["Ada"]],
    rowCount: 1,
    truncated: false,
  };
  const render = async (
    hasNextPage: boolean,
    totalRows: string | null,
    overrides: Partial<typeof output> = {},
  ) => {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <CellOutputView
            output={{ ...output, ...overrides }}
            allowCsvDownload
            hasNextPage={hasNextPage}
            totalRows={totalRows}
          />
        </AgentNativeI18nProvider>,
      ),
    );
  };
  const csvButton = () =>
    container.querySelector<HTMLButtonElement>(
      '.nb-result-footer button[aria-label="Download CSV"]',
    );
  const disabled = () => csvButton()?.disabled;
  await render(true, "2");
  expect(disabled()).toBe(true);
  await render(false, "1", { truncated: true });
  expect(disabled()).toBe(true);
  await render(false, "1", { rowCount: 2 });
  expect(disabled()).toBe(true);
  await render(false, "not-a-number");
  expect(disabled()).toBe(true);
  await render(false, null);
  expect(disabled()).toBe(false);
  await render(false, "1");
  expect(disabled()).toBe(false);
  expect(csvButton()?.textContent).toBe("");
  expect(csvButton()?.querySelector(".tabler-icon-download")).not.toBeNull();
  await act(async () => root.unmount());
  container.remove();
});

it("confirms a CSV download with a toast and reports a failed one", async () => {
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
            columns: [{ name: "name", type: "string" }],
            rows: [["Ada"]],
            rowCount: 1,
            truncated: false,
          }}
          allowCsvDownload
          hasNextPage={false}
          totalRows={null}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const button = container.querySelector<HTMLButtonElement>(
    '.nb-result-footer button[aria-label="Download CSV"]',
  );
  const create = vi.fn(() => "blob:csv");
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
  await act(async () => button?.click());
  expect(toasts.success).toHaveBeenCalledWith("CSV downloaded");
  create.mockImplementation(() => {
    throw new Error("blocked");
  });
  await act(async () => button?.click());
  expect(toasts.error).toHaveBeenCalledWith(
    "We were unable to download your CSV. Please try again.",
  );
  await act(async () => root.unmount());
  container.remove();
});

it("copies the complete result as tab-delimited text and reports a refused copy", async () => {
  toasts.success.mockClear();
  toasts.error.mockClear();
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
              { name: "name", type: "string" },
              { name: "n", type: "number" },
            ],
            rows: [["Ada", 1]],
            rowCount: 1,
            truncated: false,
          }}
          allowCsvDownload
          hasNextPage={false}
          totalRows={null}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const button = container.querySelector<HTMLButtonElement>(
    '.nb-result-footer button[aria-label="Copy data"]',
  );
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  await act(async () => button?.click());
  expect(writeText).toHaveBeenCalledWith("name\tn\r\nAda\t1\r\n");
  expect(toasts.success).toHaveBeenCalledWith("Data copied to clipboard");
  writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => button?.click());
  expect(toasts.error).toHaveBeenCalledWith(
    expect.stringContaining("unable to copy your data"),
  );
  await act(async () => root.unmount());
  container.remove();
});
