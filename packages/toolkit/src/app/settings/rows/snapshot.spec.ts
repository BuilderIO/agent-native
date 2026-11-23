// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  compareSettingsSnapshots,
  diffSettingsSnapshots,
  snapshotSettings,
  type SettingsBehaviorWitness,
} from "./snapshot.js";

function row(id: string, part: string, name: string) {
  return `<button data-rid="settings.demo.${id}" data-part="${part}">${name}</button>`;
}

function snapshot(...markup: string[]) {
  const container = document.createElement("div");
  container.innerHTML = markup.join("");
  return snapshotSettings(container);
}

describe("settings equivalence", () => {
  const control = "settings.row.control";
  const action = "settings.row.action";
  it("ignores whitespace runs without erasing word boundaries", () => {
    const before = snapshot(row("view", control, "Task list"));
    expect(
      diffSettingsSnapshots(
        before,
        snapshot(row("view", control, "  Task\n list ")),
      ),
    ).toEqual([]);
    expect(
      diffSettingsSnapshots(before, snapshot(row("view", control, "Tasklist"))),
    ).toEqual([
      'settings.demo.view: name "Task list" (reference) vs "Tasklist" (house)',
    ]);
  });
  it("reports missing rows, changes of owning part, and order within a part", () => {
    const a = row("a", control, "A");
    const b = row("b", control, "B");
    const c = row("c", action, "C");
    expect(diffSettingsSnapshots(snapshot(a, c, b), snapshot(c, a, b))).toEqual(
      ["order differs"],
    );
    expect(
      diffSettingsSnapshots(
        snapshot(a, b, c),
        snapshot(b, a, row("c", control, "C")),
      ),
    ).toEqual([
      'settings.demo.c: part "settings.row.action" (reference) vs "settings.row.control" (house)',
      "order differs",
      "order differs within settings.row.control",
    ]);
    expect(diffSettingsSnapshots(snapshot(a, b), snapshot(b, c))).toEqual([
      "missing in house: settings.demo.a",
      "missing in reference: settings.demo.c",
    ]);
  });
});

describe("skin choices", () => {
  const rid = "settings.demo.view";
  const part = "settings.row.control";
  const choice = {
    rid,
    key: null,
    referenceFamily: "menu",
    houseFamily: "select",
    reason: "The same views can be chosen from either control.",
  };
  const reference = snapshot(
    `<button data-rid="${rid}" data-part="${part}" aria-expanded="true">Board</button>`,
  );
  const house = snapshot(
    `<select data-rid="${rid}" data-part="${part}" aria-label="View">
      <option value="board">Board</option>
      <option value="list">Task list</option>
    </select>`,
  );
  const witness: SettingsBehaviorWitness = {
    rid,
    key: null,
    name: "View",
    enabled: true,
    checked: null,
    value: "board",
    choices: [
      { value: "board", label: "Board", enabled: true },
      { value: "list", label: "Task list", enabled: true },
    ],
    effect: { kind: "write", target: "set-view", result: { value: "list" } },
    error: null,
    recovery: null,
    keyboard: { reachable: true, operable: true },
  };

  function compare(houseWitness: SettingsBehaviorWitness) {
    return compareSettingsSnapshots(reference, house, {
      skinChoices: [choice],
      referenceWitnesses: [witness],
      houseWitnesses: [houseWitness],
    });
  }

  it("records a family change with independently observed equivalent behavior", () => {
    expect(
      compare({ ...witness, choices: [...witness.choices].reverse() }),
    ).toEqual({
      differences: [],
      skinChoices: [choice],
    });
  });

  it("reports behavior changes even when the family difference is registered", () => {
    const result = compare({
      ...witness,
      name: "Display",
      enabled: true,
      value: "list",
      choices: [{ value: "list", label: "Task list", enabled: false }],
      effect: { kind: "write", target: "set-view", result: { value: "board" } },
      error: "Unavailable",
      recovery: { kind: "action", target: "retry-view", result: "ready" },
      keyboard: { reachable: true, operable: false },
    });
    expect(result.skinChoices).toEqual([choice]);
    for (const field of [
      "name",
      "value",
      "choices",
      "effect",
      "error",
      "recovery",
      "keyboard",
    ]) {
      expect(
        result.differences.some((line) => line.startsWith(`${rid}: ${field}`)),
      ).toBe(true);
    }
    expect(result.differences).toContain(
      `${rid}: keyboard could not reach and operate the row in house`,
    );
  });

  it("requires witnesses and retains row presence and in-part ordering", () => {
    expect(
      compareSettingsSnapshots(reference, house, {
        skinChoices: [choice],
      }).differences,
    ).toContain(`${rid}: missing reference and house behavior witness`);

    expect(
      compareSettingsSnapshots(reference, [], {
        skinChoices: [choice],
      }).differences,
    ).toEqual([`missing in house: ${rid}`]);

    const a = row("a", part, "A");
    const b = row("b", part, "B");
    expect(
      compareSettingsSnapshots(snapshot(a, b), snapshot(b, a)).differences,
    ).toEqual([`order differs within ${part}`]);
    expect(
      compareSettingsSnapshots(reference, house, {
        referenceWitnesses: [witness],
        houseWitnesses: [witness],
      }).differences,
    ).toEqual([
      `${rid}: role "button" (reference) vs "combobox" (house)`,
      `${rid}: expanded true (reference) vs null (house)`,
    ]);
  });
});
