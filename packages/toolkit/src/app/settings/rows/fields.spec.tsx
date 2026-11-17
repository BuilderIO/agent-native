// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveSettingsSummary } from "./model.js";
import type {
  SettingsRowDefinition,
  SettingsSectionDefinition,
  SettingsSubmitResult,
} from "./schema.js";
import { SettingsSections } from "./SettingsSections.js";

describe("settings rows: fields real settings pages needed", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  const tagged = (rid: string, part: string) =>
    document.body.querySelector(`[data-rid="${rid}"][data-part="${part}"]`);
  const press = (rid: string, part = "settings.row.control") => {
    const element = tagged(rid, part);
    if (!element) throw new Error(`no ${part} for ${rid}`);
    const button = (
      element.matches("button") ? element : element.querySelector("button")
    ) as HTMLButtonElement;
    act(() => button.click());
  };

  it("keeps selected choices in saved order and visible while filtering", () => {
    const writes = vi.fn();
    const sections: SettingsSectionDefinition[] = [
      {
        id: "languages",
        rows: [
          {
            id: "settings.languages",
            kind: "multi-select",
            label: "Languages",
            searchable: true,
            options: [
              { value: "en", label: "English" },
              { value: "ja", label: "Japanese" },
              { value: "es", label: "Spanish" },
            ],
            binding: { value: ["ja", "en"], set: writes },
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    const choices = () =>
      Array.from(container.querySelectorAll('[role="checkbox"]'), (node) =>
        node.getAttribute("aria-label"),
      );
    expect(choices()).toEqual(["Japanese", "English", "Spanish"]);
    const field = container.querySelector("input") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setValue) throw new Error("input value setter unavailable");
    act(() => {
      setValue.call(field, "span");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(choices()).toEqual(["Japanese", "English", "Spanish"]);
    act(() => {
      setValue.call(field, "zzzz");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(choices()).toEqual(["Japanese", "English"]);
    act(() =>
      (
        container.querySelector('[role="checkbox"]') as HTMLButtonElement
      ).click(),
    );
    expect(writes).toHaveBeenCalledWith(["en"]);
  });

  it("joins two option rows in a status summary and measures all against allCount", () => {
    const row: SettingsRowDefinition = {
      id: "settings.notifications.email",
      kind: "disclosure",
      label: "Email",
      expanded: false,
      setExpanded: () => {},
      rows: [
        {
          id: "settings.notifications.email.enabled",
          kind: "toggle",
          label: "Enabled",
          binding: { value: true },
        },
        {
          id: "settings.notifications.email.general",
          kind: "checkbox-group",
          label: "General",
          options: [
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ],
          binding: { value: ["a", "c"] },
        },
        {
          id: "settings.notifications.email.features",
          kind: "checkbox-group",
          label: "Features",
          options: [{ value: "c", label: "Gamma" }],
          binding: { value: ["a", "c"] },
        },
      ],
    };
    if (row.kind !== "disclosure") throw new Error("unreachable");
    const content = {
      kind: "selection-status" as const,
      enabledBy: "settings.notifications.email.enabled" as const,
      selectedOptionsFrom: [
        "settings.notifications.email.general",
        "settings.notifications.email.features",
      ] as const,
      disabled: "Disabled",
      none: "Enabled",
      all: "Enabled for all",
      partial: "Enabled for {list}",
      list: {
        separator: ", ",
        overflow: { maxNamed: 2, template: "{remaining} others" },
      },
    };
    expect(
      deriveSettingsSummary(row, { when: "always", content }, row.rows),
    ).toBe("Enabled for Alpha, Gamma");
    expect(
      deriveSettingsSummary(
        row,
        { when: "always", content: { ...content, allCount: 2 } },
        row.rows,
      ),
    ).toBe("Enabled for all");
  });

  it("asks before a write the binding marks, and writes only on confirm", () => {
    const writes: boolean[] = [];
    function Page() {
      const [on, setOn] = useState(true);
      const sections: SettingsSectionDefinition[] = [
        {
          id: "team",
          rows: [
            {
              id: "settings.team.triage",
              kind: "toggle",
              label: "Triage",
              binding: {
                value: on,
                set: (value) => {
                  writes.push(value);
                  setOn(value);
                },
                confirm: {
                  when: (next) => next === false,
                  title: "Turn off triage?",
                  confirmLabel: "Turn off",
                  cancelLabel: "Cancel",
                },
              },
            },
          ],
        },
      ];
      return <SettingsSections sections={sections} />;
    }
    act(() => root.render(<Page />));
    press("settings.team.triage");
    expect(writes).toEqual([]);
    expect(
      tagged("settings.team.triage.dialog", "settings.dialog"),
    ).not.toBeNull();
    press("settings.team.triage.dialog.cancel", "settings.dialog.action");
    expect(writes).toEqual([]);
    press("settings.team.triage");
    press("settings.team.triage.dialog.confirm", "settings.dialog.action");
    expect(writes).toEqual([false]);
    press("settings.team.triage");
    expect(writes).toEqual([false, true]);
  });

  it("shows why a toggle's write was rejected and clears it on the next write", async () => {
    let fail = true;
    const sections: SettingsSectionDefinition[] = [
      {
        id: "team",
        rows: [
          {
            id: "settings.team.triage",
            kind: "toggle",
            label: "Triage",
            binding: {
              value: true,
              set: async () => {
                if (fail) throw new Error("Not allowed for this workspace");
              },
            },
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    await act(async () => press("settings.team.triage"));
    expect(
      tagged("settings.team.triage", "settings.row.error")?.textContent,
    ).toBe("Not allowed for this workspace");
    fail = false;
    await act(async () => press("settings.team.triage"));
    expect(tagged("settings.team.triage", "settings.row.error")).toBeNull();
  });

  it("shows why a number, select or option write was rejected", async () => {
    const reject = async () => {
      throw new Error("Out of range for this plan");
    };
    const sections: SettingsSectionDefinition[] = [
      {
        id: "limits",
        rows: [
          {
            id: "settings.limits.count",
            kind: "number",
            label: "Count",
            binding: { value: 1, set: reject },
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    const input = document.querySelector(
      '[data-row-kind="number"] input',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "9");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      tagged("settings.limits.count", "settings.row.error")?.textContent,
    ).toBe("Out of range for this plan");
  });

  it("refuses a select write the binding marks for confirmation instead of skipping the ask", async () => {
    const set = vi.fn();
    const sections: SettingsSectionDefinition[] = [
      {
        id: "limits",
        rows: [
          {
            id: "settings.limits.mode",
            kind: "select",
            label: "Mode",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
            binding: {
              value: "a",
              set,
              confirm: {
                when: () => true,
                title: "Change mode?",
                confirmLabel: "Change",
                cancelLabel: "Cancel",
              },
            },
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    const trigger = document.querySelector(
      '[data-row-kind="select"] [role="combobox"], [data-row-kind="select"] button',
    ) as HTMLElement;
    act(() => trigger.click());
    const option = Array.from(
      document.body.querySelectorAll('[role="option"]'),
    ).find((node) => node.textContent?.includes("B")) as HTMLElement;
    await act(async () => option.click());
    expect(set).not.toHaveBeenCalled();
    expect(
      tagged("settings.limits.mode", "settings.row.error")?.textContent,
    ).toMatch(/confirmation/);
  });

  it("keeps a confirm dialog open and shows why its action failed", async () => {
    const sections: SettingsSectionDefinition[] = [
      {
        id: "danger",
        rows: [
          {
            id: "settings.danger.reset",
            kind: "action",
            label: "Reset",
            action: {
              id: "settings.danger.reset.action",
              label: "Reset",
              trigger: {
                kind: "confirm",
                title: "Reset everything?",
                confirmLabel: "Reset now",
                cancelLabel: "Cancel",
                run: async () => {
                  throw new Error("Reset is locked");
                },
              },
            },
          },
        ],
      } as SettingsSectionDefinition,
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    const opener = Array.from(document.body.querySelectorAll("button")).find(
      (node) => node.textContent === "Reset",
    ) as HTMLButtonElement;
    act(() => opener.click());
    const confirm = Array.from(document.body.querySelectorAll("button")).find(
      (node) => node.textContent === "Reset now",
    ) as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Reset is locked",
    );
    expect(
      Array.from(document.body.querySelectorAll("button")).some(
        (node) => node.textContent === "Reset now",
      ),
    ).toBe(true);
  });

  it("shows why a text row's write was rejected", async () => {
    const sections: SettingsSectionDefinition[] = [
      {
        id: "profile",
        rows: [
          {
            id: "settings.profile.name",
            kind: "text",
            label: "Name",
            binding: {
              value: "",
              set: async () => {
                throw new Error("Name is reserved");
              },
            },
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    const input = document.querySelector(
      '[data-row-kind="text"] input',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "root");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      tagged("settings.profile.name", "settings.row.error")?.textContent,
    ).toBe("Name is reserved");
  });

  it("keeps what was typed in a change-commit text row while its write is pending", async () => {
    const sections: SettingsSectionDefinition[] = [
      {
        id: "profile",
        rows: [
          {
            id: "settings.profile.nickname",
            kind: "text",
            label: "Nickname",
            binding: { value: "", set: () => new Promise<void>(() => {}) },
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    const input = document.querySelector(
      '[data-row-kind="text"] input',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "ada");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("ada");
  });

  it("keeps an add form open with its values and shows the message when a submit does not save", async () => {
    const submits: unknown[] = [];
    let result: SettingsSubmitResult = { error: "That name is taken" };
    const sections: SettingsSectionDefinition[] = [
      {
        id: "labels",
        rows: [
          {
            id: "settings.labels.list",
            kind: "collection",
            label: "Labels",
            emptyLabel: "No labels",
            items: { status: "ready", value: [] },
            add: {
              kind: "fields",
              label: "New label",
              submitLabel: "Create",
              fields: [
                {
                  kind: "text",
                  id: "name",
                  label: "Name",
                  required: true,
                  maxLength: 5,
                },
                {
                  kind: "color",
                  id: "color",
                  label: "Color",
                  initialValue: "red",
                  keepAfterSubmit: true,
                  options: [
                    { value: "red", label: "Red" },
                    { value: "blue", label: "Blue" },
                  ],
                },
              ],
              submit: (values) => {
                submits.push({ ...values });
                return result;
              },
            },
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    press("settings.labels.list.add", "settings.collection.add");
    const field = tagged(
      "settings.labels.list.add.name",
      "settings.collection.field",
    )!.querySelector("input") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      setValue.call(field, "Urgent!");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(field.value).toBe("Urgen");
    await act(async () => {
      (
        tagged(
          "settings.labels.list.add.submit",
          "settings.dialog.action",
        )!.querySelector("button") as HTMLButtonElement
      ).click();
    });
    expect(submits).toEqual([{ name: "Urgen", color: "red" }]);
    expect(
      tagged("settings.labels.list.add.error", "settings.collection.error")
        ?.textContent,
    ).toBe("That name is taken");
    expect(field.value).toBe("Urgen");
    result = undefined;
    await act(async () => {
      (
        tagged(
          "settings.labels.list.add.submit",
          "settings.dialog.action",
        )!.querySelector("button") as HTMLButtonElement
      ).click();
    });
    expect(submits).toHaveLength(2);
    expect(
      tagged("settings.labels.list.add.error", "settings.collection.error"),
    ).toBeNull();
  });

  it("draws a link and a disclosure as whole-row controls named by all their text", () => {
    const sections: SettingsSectionDefinition[] = [
      {
        id: "more",
        rows: [
          {
            id: "settings.dictation.history",
            kind: "link",
            label: "History",
            description: "Everything you dictated",
            href: "/settings/dictation/history",
            value: "12 items",
          },
          {
            id: "settings.notifications.desktop",
            kind: "disclosure",
            label: "Desktop",
            expanded: false,
            setExpanded: () => {},
            rows: [],
          },
        ],
      },
    ];
    act(() => root.render(<SettingsSections sections={sections} />));
    // Names are compared without spaces: renderers space text differently.
    const name = (element: Element | null) =>
      (element?.textContent ?? "").replace(/\s+/g, "");
    const link = tagged("settings.dictation.history", "settings.row.control");
    expect(link?.closest("a") ?? link?.querySelector("a")).toBeTruthy();
    const anchor = (link?.closest("a") ?? link?.querySelector("a"))!;
    expect(anchor.getAttribute("href")).toBe("/settings/dictation/history");
    expect(name(anchor)).toBe("HistoryEverythingyoudictated12items");

    const disclosure = tagged(
      "settings.notifications.desktop",
      "settings.row.control",
    );
    const toggle = (
      disclosure?.matches("button")
        ? disclosure
        : disclosure?.querySelector("button")
    ) as HTMLButtonElement | null;
    expect(toggle).toBeTruthy();
    expect(name(toggle)).toBe("Desktop");
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
  });
  it("routes a navigate trigger through the router instead of a document load", () => {
    // Settings → Automations → "New automation" is an add trigger whose
    // href is written from the mounted route. Left to the browser, the anchor
    // loads /settings/app-automations/setup at the origin root, outside the app's
    // basename, so the control lands on the host's "Page not found". The router
    // has to own the click, as it already does for a whole-row link.
    const sections: SettingsSectionDefinition[] = [
      {
        id: "settings.automations",
        rows: [
          {
            id: "settings.automations.rules",
            kind: "collection",
            label: "Automations",
            columns: [],
            items: { status: "ready", value: [] },
            add: {
              kind: "trigger",
              action: {
                id: "new",
                label: "New automation",
                trigger: {
                  kind: "navigate",
                  href: "/settings/app-automations/setup",
                },
              },
            },
          },
        ],
      },
    ];
    let seen = "";
    function Probe() {
      seen = useLocation().pathname;
      return null;
    }
    act(() =>
      root.render(
        <MemoryRouter
          basename="/notes"
          initialEntries={["/notes/settings/app-automations"]}
        >
          <SettingsSections sections={sections} />
          <Probe />
        </MemoryRouter>,
      ),
    );
    const anchor = Array.from(container.querySelectorAll("a")).find(
      (node) => (node.textContent ?? "").trim() === "New automation",
    );
    expect(anchor).toBeTruthy();
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    act(() => {
      anchor!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(seen).toBe("/settings/app-automations/setup");
  });
});
