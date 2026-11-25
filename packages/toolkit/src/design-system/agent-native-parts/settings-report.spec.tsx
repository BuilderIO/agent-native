// @vitest-environment jsdom
import {
  captureRows,
  type ScreenModel,
} from "@agent-native/design-system/model";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModelSurface } from "../parts.js";

afterEach(cleanup);

describe("settings report part", () => {
  it("draws its action beside the title and its rows, then its slot, in a card", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.usage.alerts",
          part: "settings.report",
          label: "Your alerts",
          anchor: "usage-alerts",
          regions: { action: "add" },
          slot: "dialog",
          rows: [
            {
              id: "settings.usage.alerts.budget",
              part: "settings.row",
              label: "Budget",
            },
          ],
        },
      ],
    };
    render(
      <ModelSurface
        model={model}
        slots={{
          add: <button type="button">Add alert</button>,
          dialog: <p data-testid="dialog">Editing</p>,
        }}
      />,
    );
    const section = document.getElementById("usage-alerts");
    const header = section?.querySelector(":scope > .item-group-header");
    expect(
      header?.querySelector(".item-group-label[data-rid-label]")?.textContent,
    ).toBe("Your alerts");
    expect(header?.querySelector("button")?.textContent).toBe("Add alert");
    const list = section?.querySelector(":scope > .item-group");
    expect(list?.getAttribute("data-variant")).toBe("outline");
    expect(
      [...(list?.children ?? [])].map(
        (child) => child.className || child.tagName.toLowerCase(),
      ),
    ).toEqual(["item", "p"]);
    expect(captureRows(document).map((row) => [row.id, row.name])).toEqual([
      ["settings.usage.alerts", "Your alerts"],
      ["settings.usage.alerts.budget", "Budget"],
    ]);
  });

  it("draws a body region without the list", () => {
    const model: ScreenModel = {
      id: "settings",
      rows: [
        {
          id: "settings.usage.history",
          part: "settings.report",
          label: "History",
          anchor: "usage-history",
          regions: { body: "chart" },
        },
      ],
    };
    render(<ModelSurface model={model} slots={{ chart: <figure /> }} />);
    const section = document.getElementById("usage-history");
    expect(section?.querySelector(".item-group")).toBeNull();
    expect(section?.querySelector(":scope > figure")).not.toBeNull();
  });
});
