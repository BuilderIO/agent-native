// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { cellSchema, type Cell } from "@/lib/model/contracts";

import { linkedInputRange } from "../../../shared/input-range";
import {
  PublishedInputControl,
  type InputUpdate,
} from "./PublishedInputControl";

const timestamp = "2026-11-19T00:00:00.000Z";

function inputCell(id: string, fields: Record<string, unknown>): Cell {
  return cellSchema.parse({
    id,
    projectId: "project",
    versionId: "release",
    createdAt: timestamp,
    updatedAt: timestamp,
    contents: {
      id,
      kind: "input",
      order: id,
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
      ...fields,
    },
  });
}

const period = inputCell("period", {
  name: "period",
  label: "Period",
  inputType: "DROPDOWN",
  defaultValueString: "30d",
  options: ["30d", "custom"],
  optionLabels: { "30d": "Last 30 days", custom: "Custom range" },
  rangeInputs: { start: "begin", end: "finish" },
});
const begin = inputCell("begin", {
  name: "begin",
  inputType: "DATE",
  hidden: true,
  defaultValueString: "2026-10-01",
});
const finish = inputCell("finish", {
  name: "finish",
  inputType: "DATE",
  hidden: true,
  defaultValueString: "2026-10-31",
});
const linked = linkedInputRange([period, begin, finish], period);

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(
  values: Record<string, string>,
  range = linked,
  onCommitValues: (updates: InputUpdate[]) => void = () => {},
) {
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <PublishedInputControl
          cell={period}
          range={range}
          values={values}
          choices={undefined}
          onChange={() => {}}
          onCommit={() => {}}
          onCommitValues={onCommitValues}
        />
      </AgentNativeI18nProvider>,
    ),
  );
}

function dateField(label: string) {
  return container.querySelector<HTMLInputElement>(
    `input[type="date"][aria-label="${label}"]`,
  );
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("links the hidden date bounds to the period dropdown", () => {
  expect(linked?.start.id).toBe("begin");
  expect(linked?.end.id).toBe("finish");
});

it("shows no date fields while a preset is selected", async () => {
  await render({});
  expect(dateField("Start date")).toBeNull();
  expect(dateField("End date")).toBeNull();
});

it("shows the saved bounds once Custom range is selected", async () => {
  await render({ period: "custom", begin: "2026-10-05", finish: "2026-10-09" });
  expect(dateField("Start date")?.value).toBe("2026-10-05");
  expect(dateField("End date")?.value).toBe("2026-10-09");
});

it("falls back to the bound defaults when nothing was saved", async () => {
  await render({ period: "custom" });
  expect(dateField("Start date")?.value).toBe("2026-10-01");
  expect(dateField("End date")?.value).toBe("2026-10-31");
});

it("commits both bounds together and only when the range is valid", async () => {
  const commits: InputUpdate[][] = [];
  await render({ period: "custom" }, linked, (updates) =>
    commits.push(updates),
  );
  await type(dateField("Start date")!, "2026-11-20");
  expect(commits).toHaveLength(0);
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    messages.publishedApp.rangeInvalid,
  );
  await type(dateField("End date")!, "2026-11-25");
  expect(commits).toHaveLength(1);
  expect(commits[0]!.map(({ cell, value }) => [cell.id, value])).toEqual([
    ["begin", "2026-11-20"],
    ["finish", "2026-11-25"],
  ]);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("does not commit a malformed date", async () => {
  const commits: InputUpdate[][] = [];
  await render({ period: "custom" }, linked, (updates) =>
    commits.push(updates),
  );
  await type(dateField("Start date")!, "");
  expect(commits).toHaveLength(0);
});

it("reports missing linked inputs instead of hiding the control", async () => {
  await render({ period: "custom" }, null);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    messages.publishedApp.rangeUnavailable,
  );
});
