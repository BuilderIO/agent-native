import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { act, useState } from "react";
import type { createRoot as createRootType } from "react-dom/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { builtinEnvironments } from "vitest/runtime";

import type { InputCellContents } from "../app/components/notebook/InputCellControl";
import enUS from "../app/i18n/en-US";
import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import getProject from "./get-project.js";
import saveProjectCell from "./save-project-cell.js";

let dom:
  | Awaited<ReturnType<(typeof builtinEnvironments)["happy-dom"]["setup"]>>
  | undefined;
let createRoot: typeof createRootType;
let InputCellControl: typeof import("../app/components/notebook/InputCellControl").InputCellControl;

const dir = mkdtempSync(join(tmpdir(), "input-persistence-"));
const previousDatabase = process.env.DATABASE_URL;
const orgId = `input-test-${randomUUID()}`;
const email = "input-owner@example.test";
const context = {
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
};
const actor = <T,>(fn: () => T) =>
  runWithRequestContext(
    {
      userEmail: email,
      orgId,
      authUserId: email,
      userName: "Input test",
      isSyntheticTraffic: true,
    },
    fn,
  );

beforeAll(async () => {
  dom = await builtinEnvironments["happy-dom"].setup(globalThis, {});
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  ({ createRoot } = await import("react-dom/client"));
  ({ InputCellControl } =
    await import("../app/components/notebook/InputCellControl"));
  process.env.DATABASE_URL = `pglite:${join(dir, "db")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "input_test_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "Input test",
    createdBy: email,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email,
    role: "owner",
    joinedAt: Date.now(),
  });
});
afterAll(async () => {
  await closeDbExec();
  await dom?.teardown(globalThis);
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  rmSync(dir, { recursive: true, force: true });
});

it("saves mounted input edits through the action and reloads their exact defaults", async () => {
  const base = {
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "input" as const,
    name: "region",
  };
  const drafts = [
    {
      ...base,
      id: "input_text",
      inputType: "TEXT_INPUT" as const,
      defaultValueString: "old",
    },
    {
      ...base,
      id: "input_date",
      inputType: "DATE" as const,
      defaultValueString: "2025-01-01",
    },
    {
      ...base,
      id: "input_check",
      inputType: "CHECKBOX" as const,
      defaultValueString: "true",
    },
    {
      ...base,
      id: "input_multi",
      inputType: "MULTISELECT" as const,
      defaultValueString: "[]",
      options: ["EMEA", "APAC", "AMER"],
    },
    {
      ...base,
      id: "input_drop",
      inputType: "DROPDOWN" as const,
      defaultValueString: "EMEA",
      options: ["EMEA", "APAC"],
      optional: true,
    },
    {
      ...base,
      id: "input_slider",
      inputType: "SLIDER" as const,
      defaultValueString: "0",
    },
  ];
  const project = await createProject({
    ownerEmail: email,
    orgId,
    title: "Input edits",
    cells: drafts,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: InputCellContents;
  let committed: string | undefined;
  function Control({ contents }: { contents: InputCellContents }) {
    const [value, setValue] = useState(contents.defaultValueString);
    const [settings, setSettings] = useState(contents);
    return (
      <InputCellControl
        contents={settings}
        value={value}
        disabled={false}
        onChange={setValue}
        onCommit={(next) => {
          committed = next;
        }}
        onChangeContents={(next) => {
          current = next;
          setSettings(next);
        }}
      />
    );
  }
  async function saveAndReload(expected: string) {
    expect(committed).toBe(expected);
    assert(committed !== undefined);
    await actor(() =>
      saveProjectCell.run(
        {
          projectId: project.id,
          cellId: current.id,
          contents: { ...current, defaultValueString: committed },
        },
        context,
      ),
    );
    const reloaded = await actor(() =>
      getProject.run({ projectId: project.id }, context),
    );
    expect(
      reloaded.project.cells.find((cell) => cell.id === current.id)?.contents,
    ).toEqual({ ...current, defaultValueString: expected });
  }
  async function render(index: number) {
    const cell = project.cells[index];
    assert(cell);
    const contents = cell.contents;
    if (contents.kind !== "input") throw new Error("Expected input cell");
    current = contents;
    committed = undefined;
    await act(() =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <Control key={contents.id} contents={contents} />
        </AgentNativeI18nProvider>,
      ),
    );
  }
  async function openSettings() {
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="Configure input"]',
    );
    assert(trigger);
    await act(() => trigger.click());
    const panel = document.querySelector(
      '[role="dialog"][aria-label="Input settings"]',
    );
    assert(panel);
    return { panel, close: () => act(() => trigger.click()) };
  }
  async function setValue(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    assert(setter);
    setter.call(element, value);
    await act(() =>
      element.dispatchEvent(new Event("input", { bubbles: true })),
    );
  }
  await render(0);
  let input = host.querySelector("input");
  assert(input);
  await setValue(input, "hello world");
  await act(() =>
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
  await saveAndReload("hello world");
  await render(1);
  input = host.querySelector("input");
  assert(input);
  await setValue(input, "2026-11-08");
  await act(() =>
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
  await saveAndReload("2026-11-08");
  await render(2);
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]');
  assert(toggle);
  await act(() => toggle.click());
  await saveAndReload("false");
  await render(3);
  const multiselect = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Values for region"]',
  );
  assert(multiselect);
  const boxes = () =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[role="group"][aria-label="region"] [role="checkbox"]',
      ),
    );
  await act(() => multiselect.click());
  const options = boxes();
  const emea = options.at(0);
  const apac = options.at(1);
  assert(emea && apac);
  await act(() => emea.click());
  await act(() => apac.click());
  await act(() => multiselect.click());
  await saveAndReload('["EMEA","APAC"]');
  await act(() => multiselect.click());
  const selectedEmea = boxes().at(0);
  assert(selectedEmea);
  await act(() => selectedEmea.click());
  await act(() => multiselect.click());
  await saveAndReload('["APAC"]');
  await render(4);
  const dropdownSettings = await openSettings();
  const textarea = dropdownSettings.panel.querySelector("textarea");
  assert(textarea);
  await setValue(textarea, "EMEA, APAC, LATAM");
  await dropdownSettings.close();
  expect(current.options).toEqual(["EMEA", "APAC", "LATAM"]);
  const dropdown = host.querySelector<HTMLButtonElement>('[role="combobox"]');
  assert(dropdown);
  await act(() => dropdown.click());
  const clear = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent === "Clear selection");
  assert(clear);
  await act(() => clear.click());
  await saveAndReload("");
  await render(5);
  const sliderSettings = await openSettings();
  const max = sliderSettings.panel.querySelector<HTMLInputElement>(
    'input[name="slider-max"]',
  );
  assert(max);
  await setValue(max, "20");
  const min = sliderSettings.panel.querySelector<HTMLInputElement>(
    'input[name="slider-min"]',
  );
  assert(min);
  await setValue(min, "-10");
  const step = sliderSettings.panel.querySelector<HTMLInputElement>(
    'input[name="slider-step"]',
  );
  assert(step);
  await setValue(step, "0.5");
  await sliderSettings.close();
  input = host.querySelector('input[type="range"]');
  assert(input);
  expect([input.min, input.max, input.step]).toEqual(["-10", "20", "0.5"]);
  await setValue(input, "10");
  await act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
    ),
  );
  await saveAndReload("10");
  const loaded = await actor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  const saved = loaded.project.cells.find(
    (cell) => cell.id === current.id,
  )?.contents;
  assert(saved?.kind === "input");
  expect(saved.sliderOptions).toEqual({ min: -10, max: 20, step: 0.5 });
  await act(() => root.unmount());
  host.remove();
});
