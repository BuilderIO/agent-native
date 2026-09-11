/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimezoneSelect } from "./TimezoneSelect.js";

function trigger(): HTMLButtonElement {
  const el = document.querySelector("[role=combobox]");
  if (!el) throw new Error("no combobox trigger");
  return el as HTMLButtonElement;
}

describe("TimezoneSelect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    // cmdk measures and scrolls its list; jsdom implements neither.
    Element.prototype.scrollIntoView = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(value: string, systemLabel?: string) {
    act(() => {
      root.render(
        <TimezoneSelect
          value={value}
          systemLabel={systemLabel}
          onChange={() => {}}
        />,
      );
    });
  }

  it("labels the trigger with the system choice when following the browser", () => {
    render("system", "Follow this browser (UTC)");

    expect(trigger().textContent).toBe("Follow this browser (UTC)");
  });

  it("labels a pinned zone with its GMT offset", () => {
    render("Asia/Kolkata");

    // Half-hour zones are the case a naive hour-only offset gets wrong.
    expect(trigger().textContent).toBe("(GMT+05:30) Asia/Kolkata");
  });

  it("orders zones west to east and annotates each with its local time", () => {
    render("UTC", "Follow this browser (UTC)");
    act(() => {
      trigger().click();
    });

    // The first group pins the browser choices; the last holds the full list.
    const groups = document.querySelectorAll("[cmdk-group]");
    const list = groups[groups.length - 1];
    const zoned = [...list.querySelectorAll("[cmdk-item]")].map(
      (row) => row.textContent?.trim() ?? "",
    );
    expect(zoned.length).toBeGreaterThan(100);

    const offsets = zoned.map((row) => {
      const match = /^\(GMT([+-])(\d{2}):(\d{2})\)/.exec(row ?? "");
      if (!match) throw new Error(`unparsable row: ${row}`);
      return (
        (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
      );
    });
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));

    // Every zone row ends with its current local time.
    for (const row of zoned) {
      expect(row).toMatch(/\d{1,2}:\d{2}(am|pm)$/);
    }
  });

  it("keeps a stored zone selectable even when the runtime omits it", () => {
    const supported = Intl.supportedValuesOf;
    vi.spyOn(Intl, "supportedValuesOf").mockImplementation((key) =>
      key === "timeZone"
        ? ["UTC", "Europe/Paris"]
        : (supported.call(Intl, key) as string[]),
    );

    render("America/New_York");
    act(() => {
      trigger().click();
    });

    const rows = [...document.querySelectorAll("[cmdk-item]")].map(
      (row) => row.textContent ?? "",
    );
    expect(rows.some((row) => row.includes("America/New York"))).toBe(true);

    vi.restoreAllMocks();
  });
});
