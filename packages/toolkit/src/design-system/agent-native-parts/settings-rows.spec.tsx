// @vitest-environment jsdom
import {
  captureRows,
  rowAttributes,
  type ScreenModel,
} from "@agent-native/design-system/model";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelSurface } from "../parts.js";

afterEach(cleanup);

function settingsModel({
  enabled = false,
  pending = false,
}: { enabled?: boolean; pending?: boolean } = {}): ScreenModel {
  return {
    id: "settings",
    rows: [
      {
        id: "settings.notifications.email",
        part: "settings.group",
        label: "Email",
        rows: [
          {
            id: "settings.notifications.error-email",
            part: "settings.row",
            kind: "toggle",
            label: "Error emails",
            description: "Email me when a query fails.",
            anchor: "error-email-notifications",
            state: { checked: enabled },
            effect: { kind: "action", effectId: "toggle-error-email" },
          },
          {
            id: "settings.notifications.credentials",
            part: "settings.row",
            label: "Credentials",
            anchor: "credentials",
            icon: { kind: "symbol", key: "google" },
            rows: [
              {
                id: "settings.notifications.credentials.manage",
                part: "button",
                kind: "destination",
                label: "Manage data sources",
                effect: { kind: "navigate", to: "/data-sources" },
              },
            ],
          },
          {
            id: "settings.notifications.capture",
            part: "settings.row",
            label: "Meeting capture",
            rows: [
              {
                id: "settings.notifications.capture.open",
                part: "button",
                kind: "action",
                label: "Open desktop",
                icon: { kind: "symbol", key: "external-link" },
                state: { pending },
                effect: { kind: "action", effectId: "open-desktop" },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("settings row parts", () => {
  it("draws groups and rows with their anchors and accessible names", () => {
    render(
      <MemoryRouter>
        <ModelSurface
          model={settingsModel()}
          navigate={vi.fn()}
          actions={{ "toggle-error-email": vi.fn(), "open-desktop": vi.fn() }}
        />
      </MemoryRouter>,
    );
    const toggleRow = document.getElementById("error-email-notifications");
    expect(toggleRow?.dataset.part).toBe("settings.row");
    expect(toggleRow?.classList.contains("item")).toBe(true);
    expect(toggleRow?.parentElement?.classList.contains("item-group")).toBe(
      true,
    );
    expect(
      toggleRow?.querySelector(".item-title [data-rid-label]")?.textContent,
    ).toBe("Error emails");
    expect(toggleRow?.querySelector(".item-description")?.textContent).toBe(
      "Email me when a query fails.",
    );
    expect(
      toggleRow?.querySelector(".item-actions [role='switch']"),
    ).not.toBeNull();
    expect(
      document
        .getElementById("credentials")
        ?.querySelector(".item-media[data-framed] svg"),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Email" }).classList).toContain(
      "item-group-label",
    );
    expect(
      captureRows(document).map((row) => [row.id, row.name, row.parentId]),
    ).toEqual([
      ["settings.notifications.email", "Email", null],
      [
        "settings.notifications.error-email",
        "Error emails",
        "settings.notifications.email",
      ],
      [
        "settings.notifications.credentials",
        "Credentials",
        "settings.notifications.email",
      ],
      [
        "settings.notifications.credentials.manage",
        "Manage data sources",
        "settings.notifications.credentials",
      ],
      [
        "settings.notifications.capture",
        "Meeting capture",
        "settings.notifications.email",
      ],
      [
        "settings.notifications.capture.open",
        "Open desktop",
        "settings.notifications.capture",
      ],
    ]);
  });

  it("runs a toggle row's action from its switch", () => {
    const toggle = vi.fn();
    render(
      <MemoryRouter>
        <ModelSurface
          model={settingsModel({ enabled: true })}
          navigate={vi.fn()}
          actions={{ "toggle-error-email": toggle, "open-desktop": vi.fn() }}
        />
      </MemoryRouter>,
    );
    const control = screen.getByRole("switch", { name: "Error emails" });
    expect(control.getAttribute("aria-checked")).toBe("true");
    act(() => control.click());
    expect(toggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "settings.notifications.error-email" }),
    );
  });

  it("disables a pending toggle and marks it busy", () => {
    const toggle = vi.fn();
    const model = settingsModel();
    const group = model.rows.at(0);
    const row = group?.rows?.at(0);
    if (!group?.rows || !row) throw new Error("fixture has no toggle row");
    const pendingModel: ScreenModel = {
      ...model,
      rows: [
        {
          ...group,
          rows: [
            { ...row, state: { checked: false, pending: true } },
            ...group.rows.slice(1),
          ],
        },
      ],
    };
    render(
      <MemoryRouter>
        <ModelSurface
          model={pendingModel}
          navigate={vi.fn()}
          actions={{ "toggle-error-email": toggle, "open-desktop": vi.fn() }}
        />
      </MemoryRouter>,
    );
    const control = screen.getByRole("switch", { name: "Error emails" });
    expect(control.getAttribute("aria-busy")).toBe("true");
    expect(control.hasAttribute("data-disabled")).toBe(true);
    act(() => control.click());
    expect(toggle).not.toHaveBeenCalled();
  });

  it("draws a destination as a link that navigates on a plain click only", () => {
    const navigate = vi.fn();
    render(
      <MemoryRouter
        basename="/analytics"
        initialEntries={["/analytics/settings"]}
      >
        <ModelSurface
          model={settingsModel()}
          navigate={navigate}
          actions={{ "toggle-error-email": vi.fn(), "open-desktop": vi.fn() }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Manage data sources" });
    expect(link.getAttribute("href")).toBe("/analytics/data-sources");
    expect(link.classList.contains("button")).toBe(true);
    fireEvent.click(link, { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith(
      "/data-sources",
      expect.objectContaining({
        id: "settings.notifications.credentials.manage",
      }),
    );
  });

  it("disables a pending action and marks it busy", () => {
    const open = vi.fn();
    render(
      <MemoryRouter>
        <ModelSurface
          model={settingsModel({ pending: true })}
          navigate={vi.fn()}
          actions={{ "toggle-error-email": vi.fn(), "open-desktop": open }}
        />
      </MemoryRouter>,
    );
    const button = screen.getByRole("button", { name: "Open desktop" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(
      captureRows(document).find((row) => row.id.endsWith(".open"))?.pending,
    ).toBe(true);
  });

  it("draws a group's slot above its rows", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.meetings.calendar",
          part: "settings.group",
          label: "Calendar",
          anchor: "calendar",
          slot: "calendar-state",
        },
      ],
    };
    render(
      <ModelSurface
        model={model}
        slots={{ "calendar-state": <p>Loading calendars</p> }}
      />,
    );
    expect(document.getElementById("calendar")?.textContent).toContain(
      "Loading calendars",
    );
  });

  it("throws for an icon symbol it has no glyph for", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.misc.row",
          part: "settings.row",
          label: "Row",
          icon: { kind: "symbol", key: "no-such-glyph" },
        },
      ],
    };
    expect(() => render(<ModelSurface model={model} />)).toThrow(
      /no-such-glyph/,
    );
  });

  it("draws a row's regions, badge and visually hidden group label", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.usage.alerts",
          part: "settings.group",
          label: "Alerts",
          labelHidden: true,
          rows: [
            {
              id: "settings.usage.alerts.default",
              part: "settings.row",
              label: "Monthly budget",
              description: "Plain description",
              anchor: "usage-alert-default",
              state: { badge: { kind: "label", value: "Default" } },
              regions: {
                description: "budget-description",
                status: "budget-source",
                detail: "budget-form",
              },
            },
          ],
        },
      ],
    };
    render(
      <ModelSurface
        model={model}
        slots={{
          "budget-description": <a href="/docs">Read the docs</a>,
          "budget-source": <span>Workspace</span>,
          "budget-form": <form aria-label="Budget" />,
        }}
      />,
    );
    const row = document.getElementById("usage-alert-default");
    expect(row?.querySelector(".item-description a")?.textContent).toBe(
      "Read the docs",
    );
    expect(row?.textContent).not.toContain("Plain description");
    const badge = row?.querySelector(".item-title [data-rid-label] + *");
    expect(badge?.classList.contains("badge")).toBe(true);
    expect(badge?.getAttribute("data-variant")).toBe("outline");
    expect(badge?.getAttribute("data-color")).toBe("gray");
    expect(badge?.textContent).toBe("Default");
    expect(
      row?.querySelector(".item-title [data-rid-label] + .badge + span")
        ?.textContent,
    ).toBe("Workspace");
    expect(
      row
        ?.querySelector(":scope > .item-footer > form")
        ?.getAttribute("aria-label"),
    ).toBe("Budget");
    const heading = screen.getByRole("heading", { name: "Alerts" });
    expect(heading.classList.contains("item-group-label")).toBe(true);
    expect(heading.hasAttribute("data-visually-hidden")).toBe(true);
    expect(
      captureRows(document).map((captured) => [
        captured.id,
        captured.name,
        captured.badge,
        captured.regions,
      ]),
    ).toEqual([
      ["settings.usage.alerts", "Alerts", null, null],
      [
        "settings.usage.alerts.default",
        "Monthly budget",
        "label:Default",
        "description:budget-description detail:budget-form status:budget-source",
      ],
    ]);
  });

  it("names the row by its label region's text", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.keys.openai",
          part: "settings.row",
          label: "OPENAI_API_KEY",
          regions: { label: "key-name" },
        },
      ],
    };
    render(
      <ModelSurface
        model={model}
        slots={{
          "key-name": <code>OPENAI_API_KEY</code>,
        }}
      />,
    );
    expect(captureRows(document)[0]?.name).toBe("OPENAI_API_KEY");
    expect(
      document.querySelector(".item-title [data-rid-label] > code"),
    ).not.toBeNull();
  });

  it("throws for a region it does not draw, a badge it has no design for and a notice description", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const row = (extra: Partial<ScreenModel["rows"][number]>): ScreenModel => ({
      id: "settings",
      rows: [
        {
          id: "settings.misc.row",
          part: "settings.row",
          label: "Row",
          ...extra,
        },
      ],
    });
    expect(() =>
      render(
        <ModelSurface
          model={row({ regions: { footer: "footer" } })}
          slots={{ footer: <p>Footer</p> }}
        />,
      ),
    ).toThrow(/region "footer"/);
    expect(() =>
      render(
        <ModelSurface model={row({ state: { badge: { kind: "dot" } } })} />,
      ),
    ).toThrow(/dot badge/);
    expect(() =>
      render(<ModelSurface model={row({ regions: { status: "unfilled" } })} />),
    ).toThrow(/slot "unfilled"/);
    expect(() =>
      render(
        <ModelSurface
          model={row({ part: "settings.notice", description: "More" })}
        />,
      ),
    ).toThrow(/a notice's message is its label/);
  });

  it("draws content rows in place, carrying the attributes the slot spreads", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.keys.group",
          part: "settings.group",
          label: "Keys",
          rows: [
            { id: "settings.keys.first", part: "settings.row", label: "First" },
            {
              id: "settings.keys.notice",
              part: "settings.content",
              label: "Keys are read only",
              slot: "notice",
            },
            { id: "settings.keys.last", part: "settings.row", label: "Last" },
          ],
        },
      ],
    };
    render(
      <ModelSurface
        model={model}
        slots={{
          notice: (row) => <p {...rowAttributes(row)}>Keys are read only</p>,
        }}
      />,
    );
    const body = document.querySelector(
      "[data-rid='settings.keys.group'] > .item-group",
    );
    expect(
      [...(body?.children ?? [])].map((child) => child.tagName.toLowerCase()),
    ).toEqual(["div", "p", "div"]);
    expect(
      captureRows(document).map((row) => [row.id, row.name, row.parentId]),
    ).toEqual([
      ["settings.keys.group", "Keys", null],
      ["settings.keys.first", "First", "settings.keys.group"],
      ["settings.keys.notice", "Keys are read only", "settings.keys.group"],
      ["settings.keys.last", "Last", "settings.keys.group"],
    ]);
  });

  it("draws a notice as a warning callout with its recovering action", () => {
    const retry = vi.fn();
    render(
      <ModelSurface
        model={{
          id: "settings",
          rows: [
            {
              id: "settings.usage.load-error",
              part: "settings.notice",
              label: "Usage couldn't load.",
              rows: [
                {
                  id: "settings.usage.load-error.retry",
                  part: "button",
                  kind: "action",
                  label: "Retry",
                  effect: { kind: "action", effectId: "retry" },
                },
              ],
            },
          ],
        }}
        actions={{ retry }}
      />,
    );
    const notice = document.querySelector(
      "[data-rid='settings.usage.load-error']",
    );
    expect(notice?.classList.contains("callout")).toBe(true);
    expect(notice?.getAttribute("data-color")).toBe("warning");
    expect(notice?.getAttribute("data-variant")).toBe("surface");
    expect(
      notice?.querySelector(".callout-icon")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      notice?.querySelector(".callout-text [data-rid-label]")?.textContent,
    ).toBe("Usage couldn't load.");
    expect(
      notice?.querySelector(".callout-actions [data-rid$='.retry']"),
    ).not.toBeNull();
    act(() => screen.getByRole("button", { name: "Retry" }).click());
    expect(retry).toHaveBeenCalledOnce();
    expect(captureRows(document)[0]?.name).toBe("Usage couldn't load.");
  });
});
