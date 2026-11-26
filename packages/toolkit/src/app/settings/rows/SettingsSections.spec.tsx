// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignSystemContext } from "../../../design-system/context.js";
import {
  AGENT_NATIVE_PART_SET,
  definePartSet,
  useDesignSystemPart,
  withDesignSystemParts,
} from "../../../design-system/parts.js";
import { settingsTags } from "./hooks.js";
import { isSettingsRowVisible } from "./model.js";
import { SettingsSectionsRendererProvider } from "./renderer.js";
import type {
  SettingsSectionDefinition,
  SettingsSectionsProps,
} from "./schema.js";
import { SettingsSections } from "./SettingsSections.js";

function useSections(writes: string[]): SettingsSectionDefinition[] {
  const [email, setEmail] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [kinds, setKinds] = useState<readonly string[]>(["mentions"]);
  return [
    {
      id: "general",
      label: "General",
      rows: [
        {
          id: "settings.notifications.email",
          kind: "toggle",
          label: "Email updates",
          description: "A summary of activity",
          binding: {
            value: email,
            set: (value) => {
              writes.push(`email=${value}`);
              setEmail(value);
            },
          },
        },
        {
          id: "settings.notifications.kinds",
          kind: "checkbox-group",
          label: "Notify me about",
          options: [
            { value: "mentions", label: "Mentions" },
            { value: "replies", label: "Replies" },
          ],
          binding: { value: kinds, set: (value) => setKinds(value) },
          disclosure: {
            expanded,
            setExpanded,
            summary: {
              when: "always",
              content: {
                kind: "count",
                source: { kind: "selected-options", row: "self" },
                template: "{count} types",
              },
            },
          },
        },
        {
          id: "settings.notifications.locked",
          kind: "toggle",
          label: "Locked",
          condition: { disabledReason: "Managed by your workspace" },
          binding: {
            value: true,
            set: () => {
              writes.push("locked");
            },
          },
        },
      ],
    },
  ];
}

function Page({ writes }: { writes: string[] }) {
  return <SettingsSections sections={useSections(writes)} />;
}

/** A second skin with different markup and the same tags. */
function PlainSkin({ sections }: SettingsSectionsProps) {
  return (
    <table data-skin="plain">
      <tbody>
        {sections.flatMap((section) =>
          section.rows.filter(isSettingsRowVisible).map((row) => (
            <tr key={row.id} {...settingsTags(row.id, "settings.row")}>
              <th>{row.label}</th>
              <td>
                {row.kind === "toggle" ? (
                  <button
                    type="button"
                    role="switch"
                    aria-label={row.label}
                    aria-checked={row.binding.value}
                    disabled={Boolean(row.condition?.disabledReason)}
                    {...settingsTags(row.id, "settings.row.control")}
                    onClick={() => void row.binding.set?.(!row.binding.value)}
                  />
                ) : row.kind === "checkbox-group" && row.disclosure ? (
                  <>
                    <button
                      type="button"
                      aria-expanded={row.disclosure.expanded}
                      {...settingsTags(row.id, "settings.row.control")}
                      onClick={() =>
                        row.disclosure?.setExpanded(!row.disclosure.expanded)
                      }
                    >
                      {row.label}
                      <span {...settingsTags(row.id, "settings.row.summary")}>
                        {row.binding.value.length} types
                      </span>
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

describe("SettingsSections", () => {
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
    vi.unstubAllGlobals();
  });

  const control = (rid: string) => {
    const tagged = container.querySelector(
      `[data-rid="${rid}"][data-part="settings.row.control"]`,
    );
    if (!tagged) throw new Error(`no control for ${rid}`);
    return (
      tagged.matches("button") ? tagged : tagged.querySelector("button")
    ) as HTMLButtonElement;
  };

  it("renders rows from data with the house skin and writes through the binding", () => {
    const writes: string[] = [];
    act(() => root.render(<Page writes={writes} />));
    expect(container.querySelector('[data-skin="house"]')).not.toBeNull();
    expect(
      [...container.querySelectorAll('[data-part="settings.row"]')].map((row) =>
        row.getAttribute("data-rid"),
      ),
    ).toEqual([
      "settings.notifications.email",
      "settings.notifications.kinds",
      "settings.notifications.locked",
    ]);
    act(() => control("settings.notifications.email").click());
    expect(writes).toEqual(["email=true"]);
    expect(
      control("settings.notifications.email").getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("does not write through a row disabled by its condition", () => {
    const writes: string[] = [];
    act(() => root.render(<Page writes={writes} />));
    act(() => control("settings.notifications.locked").click());
    expect(writes).toEqual([]);
    expect(container.textContent).toContain("Managed by your workspace");
  });

  it("opens a collapsible checkbox group and shows its options", () => {
    act(() => root.render(<Page writes={[]} />));
    expect(container.textContent).toContain("1 types");
    expect(
      container.querySelector('[data-part="settings.row.option"]'),
    ).toBeNull();
    act(() => control("settings.notifications.kinds").click());
    expect(
      [...container.querySelectorAll('[data-part="settings.row.option"]')].map(
        (option) => option.getAttribute("data-rid"),
      ),
    ).toEqual([
      "settings.notifications.kinds.mentions",
      "settings.notifications.kinds.replies",
    ]);
  });

  it("lets a registered renderer replace the whole part with the same rows and writes", () => {
    const writes: string[] = [];
    act(() => root.render(<Page writes={writes} />));
    const rowIds = () =>
      [...container.querySelectorAll('[data-part="settings.row"]')].map((row) =>
        row.getAttribute("data-rid"),
      );
    const houseRows = rowIds();

    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(
        <SettingsSectionsRendererProvider value={PlainSkin}>
          <Page writes={writes} />
        </SettingsSectionsRendererProvider>,
      ),
    );
    expect(container.querySelector('[data-skin="plain"]')).not.toBeNull();
    expect(container.querySelector('[data-skin="house"]')).toBeNull();
    expect(rowIds()).toEqual(houseRows);
    expect(
      control("settings.notifications.locked").hasAttribute("disabled"),
    ).toBe(true);

    act(() => control("settings.notifications.email").click());
    expect(writes).toEqual(["email=true"]);
    expect(
      control("settings.notifications.email").getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("surfaces a failed registered renderer without drawing the house part", () => {
    function BrokenSkin(): never {
      throw new Error("Custom renderer failed");
    }
    expect(() =>
      act(() =>
        root.render(
          <SettingsSectionsRendererProvider value={BrokenSkin}>
            <Page writes={[]} />
          </SettingsSectionsRendererProvider>,
        ),
      ),
    ).toThrow("Custom renderer failed");
    expect(container.querySelector('[data-skin="house"]')).toBeNull();
  });

  it("draws with the design system's settings whole part, behind an explicit renderer", () => {
    const plain = definePartSet({
      name: "plain",
      parts: AGENT_NATIVE_PART_SET.parts,
      whole: { settings: PlainSkin },
    });
    act(() =>
      root.render(
        <DesignSystemContext.Provider value={{ definition: { parts: plain } }}>
          <Page writes={[]} />
        </DesignSystemContext.Provider>,
      ),
    );
    expect(container.querySelector('[data-skin="plain"]')).not.toBeNull();

    function OtherSkin() {
      return <div data-skin="other" />;
    }
    act(() =>
      root.render(
        <DesignSystemContext.Provider value={{ definition: { parts: plain } }}>
          <SettingsSectionsRendererProvider value={OtherSkin}>
            <Page writes={[]} />
          </SettingsSectionsRendererProvider>
        </DesignSystemContext.Provider>,
      ),
    );
    expect(container.querySelector('[data-skin="other"]')).not.toBeNull();
    expect(container.querySelector('[data-skin="plain"]')).toBeNull();
  });

  it("takes whole parts by their earlier names through withDesignSystemParts", () => {
    const definition = withDesignSystemParts("plain", {
      SettingsSections: PlainSkin,
    });
    expect(definition.parts?.whole).toEqual({ settings: PlainSkin });
    expect(definition.parts?.parts).toBe(AGENT_NATIVE_PART_SET.parts);

    let found: unknown;
    function Probe() {
      found = useDesignSystemPart("SettingsSections");
      return <Page writes={[]} />;
    }
    act(() =>
      root.render(
        <DesignSystemContext.Provider value={{ definition }}>
          <Probe />
        </DesignSystemContext.Provider>,
      ),
    );
    expect(found).toBe(PlainSkin);
    expect(container.querySelector('[data-skin="plain"]')).not.toBeNull();
    expect(() =>
      withDesignSystemParts("plain", { SettingsPanel: PlainSkin }),
    ).toThrow('"SettingsPanel" is not a whole part');
  });
});
