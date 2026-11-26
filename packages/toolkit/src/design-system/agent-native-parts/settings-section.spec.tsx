// @vitest-environment jsdom
import {
  captureRows,
  type ScreenModel,
} from "@agent-native/design-system/model";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsSurfaceProvider } from "../../app/settings/SettingsSection.js";
import { ModelSurface } from "../parts.js";

afterEach(cleanup);

function sectionModel(expanded: boolean): ScreenModel {
  return {
    id: "settings",
    rows: [
      {
        id: "settings.panel.email",
        part: "settings.section",
        label: "Email",
        description: "Needed before deploy.",
        anchor: "settings-email",
        icon: { kind: "symbol", key: "mail" },
        state: {
          expanded,
          badge: { kind: "label", value: "Required", tone: "attention" },
        },
        effect: { kind: "action", effectId: "toggle-email" },
        slot: "email",
        rows: [
          {
            id: "settings.panel.email.provider",
            part: "settings.row",
            label: "Provider",
          },
        ],
      },
    ],
  };
}

describe("settings section part", () => {
  it("toggles in the sidebar and is named by its title, not its badge", () => {
    const toggle = vi.fn();
    render(
      <SettingsSurfaceProvider surface="sidebar">
        <ModelSurface
          model={sectionModel(false)}
          actions={{ "toggle-email": toggle }}
          slots={{ email: <p>Email form</p> }}
        />
      </SettingsSurfaceProvider>,
    );
    const button = screen.getByRole("button", { name: /Email/ });
    expect(button.classList).toContain("collapsible-trigger");
    expect(button.classList).toContain("item");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.querySelector(".collapsible-chevron")).not.toBeNull();
    expect(
      document
        .querySelector("[data-rid='settings.panel.email']")
        ?.classList.contains("collapsible"),
    ).toBe(true);
    expect(screen.queryByText("Email form")).toBeNull();
    act(() => button.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(captureRows(document)[0]).toMatchObject({
      id: "settings.panel.email",
      name: "Email",
      expanded: false,
      badge: "label-attention:Required",
    });
  });

  it("draws its content and rows when expanded", () => {
    render(
      <SettingsSurfaceProvider surface="sidebar">
        <ModelSurface
          model={sectionModel(true)}
          actions={{ "toggle-email": vi.fn() }}
          slots={{ email: <p>Email form</p> }}
        />
      </SettingsSurfaceProvider>,
    );
    expect(screen.getByText("Email form")).not.toBeNull();
    expect(
      screen
        .getByText("Needed before deploy.")
        .classList.contains("item-description"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /Email/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(captureRows(document).map((row) => [row.id, row.parentId])).toEqual([
      ["settings.panel.email", null],
      ["settings.panel.email.provider", "settings.panel.email"],
    ]);
  });

  it("draws a titled outlined list on a page, its attention badge a warning", () => {
    render(
      <SettingsSurfaceProvider surface="page">
        <ModelSurface
          model={sectionModel(false)}
          actions={{ "toggle-email": vi.fn() }}
          slots={{ email: <p>Email form</p> }}
        />
      </SettingsSurfaceProvider>,
    );
    const section = document.getElementById("settings-email");
    const heading = screen.getByRole("heading", { name: /Email/ });
    expect(heading.classList).toContain("item-group-label");
    expect(heading.querySelector("[data-rid-label]")?.textContent).toBe(
      "Email",
    );
    const badge = heading.querySelector(".badge");
    expect(badge?.textContent).toBe("Required");
    expect(badge?.getAttribute("data-color")).toBe("warning");
    const list = section?.querySelector(":scope > .item-group");
    expect(list?.getAttribute("data-variant")).toBe("outline");
    expect(list?.textContent).toContain("Email form");
    expect(screen.getByText("Email form")).not.toBeNull();
    expect(captureRows(document)[0]?.name).toBe("Email");
  });

  it("drops its header and list inside a group on a page", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.panel.agent",
          part: "settings.group",
          label: "Agent",
          rows: [
            {
              id: "settings.panel.limits",
              part: "settings.section",
              label: "Agent Limits",
              anchor: "settings-limits",
              state: { complete: true },
              slot: "limits",
            },
          ],
        },
      ],
    };
    render(
      <SettingsSurfaceProvider surface="page">
        <ModelSurface model={model} slots={{ limits: <p>Limits</p> }} />
      </SettingsSurfaceProvider>,
    );
    const section = document.getElementById("settings-limits");
    expect(section?.querySelector("h2")).toBeNull();
    expect(section?.querySelector(".item-group")).toBeNull();
    expect(section?.querySelector(":scope > p")?.textContent).toBe("Limits");
    expect(section?.getAttribute("data-rid-complete")).toBe("true");
  });

  it("draws a body region without the list on a page", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.panel.demo",
          part: "settings.section",
          label: "Demo mode",
          anchor: "settings-demo",
          regions: { body: "demo" },
        },
      ],
    };
    render(
      <SettingsSurfaceProvider surface="page">
        <ModelSurface model={model} slots={{ demo: <p>Demo</p> }} />
      </SettingsSurfaceProvider>,
    );
    const section = document.getElementById("settings-demo");
    expect(section?.querySelector("h2")?.textContent).toBe("Demo mode");
    expect(section?.querySelector(".item-group")).toBeNull();
    expect(section?.querySelector(":scope > p")?.textContent).toBe("Demo");
  });
});
