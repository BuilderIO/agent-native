// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellOutputSchema } from "@/lib/model/contracts";

import { CellOutputView } from "./CellOutputView";

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("report A2-FIND-20261116-F12 shows the product query error sentence, preserves missing table details, and offers Copy error", async () => {
  let copied = "";
  const writeText = vi.fn(async (value: string) => {
    copied = value;
  });
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: { writeText },
  });
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        <CellOutputView
          queryError
          output={cellOutputSchema.parse({
            type: "error",
            message: 'relation "unknown_table" does not exist',
            detail: "trace-123",
          })}
          onFixWithAgent={() => {}}
        />
      </AgentNativeI18nProvider>,
    ),
  );
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Your query could not be executed");
  expect(alert?.textContent).toContain(
    "We received the following error when executing this query:",
  );
  expect(alert?.textContent).toContain("unknown_table");
  expect(alert?.textContent).not.toMatch(/Action [a-z-]+ failed/);

  const copyButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Copy error",
  );
  expect(copyButton).toBeDefined();
  await act(async () => copyButton?.click());
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(copied).toContain('relation "unknown_table" does not exist');
  expect(copied).toContain("trace-123");
  expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard!");
});
