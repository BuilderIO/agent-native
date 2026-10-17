// @vitest-environment happy-dom

// The one color-mode select: Hex, RGB, HSL, HSB, Display P3, OKLCH. The mode
// picks the value cells and the CSS the picker writes; a color outside sRGB
// survives every mode that can hold it and is mapped, visibly, into one that
// cannot.
//
// Reference fallbacks (culori 4.0.2, CSS Color 4 gamut mapping):
//   oklch(0.7 0.3 150) -> #00c248, color(display-p3 1 0 0) -> #ff0b0c.
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import enUS from "../../../i18n/en-US";
import { DesignColorPicker } from "./DesignColorPicker";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, string>) => {
    const found = key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enUS,
      );
    if (typeof found !== "string") throw new Error(`Missing i18n key ${key}`);
    return found.replace(/\{\{(\w+)\}\}/g, (_, name) => options?.[name] ?? "");
  },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const last = <T,>(items: T[]): T | undefined => items[items.length - 1];

interface Calls {
  change: string[];
  complete: string[];
}

function Harness({ initial, calls }: { initial: string; calls: Calls }) {
  const [value, setValue] = useState(initial);
  return (
    <TooltipProvider>
      <DesignColorPicker
        value={value}
        open
        onOpenChange={() => {}}
        onChange={(next) => {
          calls.change.push(next);
          setValue(next);
        }}
        onChangeComplete={(next) => {
          calls.complete.push(next);
          setValue(next);
        }}
        trigger={<button type="button">Open picker</button>}
      />
    </TooltipProvider>
  );
}

async function renderPicker(initial: string): Promise<Calls> {
  const calls: Calls = { change: [], complete: [] };
  await act(async () =>
    root.render(<Harness initial={initial} calls={calls} />),
  );
  return calls;
}

const trigger = () =>
  document.querySelector<HTMLElement>('[aria-label="Color model"]')!;
const field = (label: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const fieldValues = (...labels: string[]) =>
  labels.map((label) => field(label)?.value ?? null);

async function chooseMode(label: string): Promise<void> {
  await act(async () => {
    trigger().focus();
    trigger().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const option = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((candidate) => candidate.textContent === label);
  if (!option) throw new Error(`No ${label} option in the mode select`);
  await act(async () => {
    option.focus();
    option.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function typeInto(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("the mode select", () => {
  it("lists Hex, RGB, HSL, HSB, a divider, then Display P3 and OKLCH", async () => {
    await renderPicker("#0a6bd6");
    await act(async () => {
      trigger().focus();
      trigger().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const listbox = document.querySelector('[role="listbox"]')!;
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (option) => option.textContent,
    );
    expect(labels).toEqual(["Hex", "RGB", "HSL", "HSB", "Display P3", "OKLCH"]);
    // One divider between HSB and Display P3, and no section labels.
    const rows = Array.from(
      listbox.querySelector('[role="option"]')!.parentElement!.children,
    ).map((child) => child.textContent?.trim());
    expect(rows.indexOf("HSB") + 2).toBe(rows.indexOf("Display P3"));
    expect(rows.filter((text) => text === "")).toHaveLength(1);
  });

  it("opens in the notation the color was written in", async () => {
    await renderPicker("oklch(0.7 0.3 150)");
    expect(trigger().textContent).toContain("OKLCH");
    expect(fieldValues("L", "C", "H")).toEqual(["70", "0.3", "150"]);
    // Hex is a mode to choose, not a field every picker has: the runtime budget
    // script switches to it before typing a hex.
    expect(field("Hex")).toBeNull();
    await act(async () => root.render(null));

    await renderPicker("color(display-p3 0.9175 0.2003 0.1386)");
    expect(trigger().textContent).toContain("Display P3");
    expect(fieldValues("R", "G", "B")).toEqual(["0.917", "0.2", "0.139"]);
    await act(async () => root.render(null));

    await renderPicker("#0a6bd6");
    expect(trigger().textContent).toContain("Hex");
    expect(field("Hex")?.value).toBe("0A6BD6");
  });

  it("switches through every mode and shows each mode's value cells", async () => {
    const calls = await renderPicker("#0a6bd6");
    expect(field("Hex")?.value).toBe("0A6BD6");

    await chooseMode("RGB");
    expect(fieldValues("R", "G", "B")).toEqual(["10", "107", "214"]);
    await chooseMode("HSL");
    expect(fieldValues("H", "S", "L")).toEqual(["211", "91", "44"]);
    await chooseMode("HSB");
    expect(fieldValues("H", "S", "B")).toEqual(["211", "95", "84"]);
    // Moving among the sRGB modes rewrites nothing: they write the same CSS.
    expect(calls.change).toEqual([]);
    expect(calls.complete).toEqual([]);

    await chooseMode("Display P3");
    expect(fieldValues("R", "G", "B")).toEqual(["0.185", "0.413", "0.811"]);
    expect(last(calls.complete)).toBe("color(display-p3 0.185 0.413 0.811)");

    await chooseMode("OKLCH");
    expect(fieldValues("L", "C", "H")).toEqual(["54.1", "0.183", "256.5"]);
    expect(last(calls.complete)).toMatch(/^oklch\(54\.1%/);

    await chooseMode("Hex");
    expect(field("Hex")?.value).toBe("0A6BD6");
    expect(last(calls.complete)).toBe("#0a6bd6");
  });

  it("maps a color outside sRGB into sRGB when leaving for an sRGB mode, and shows it", async () => {
    const calls = await renderPicker("oklch(0.7 0.3 150)");
    await chooseMode("Hex");
    expect(field("Hex")?.value).toBe("00C248");
    // What the design now holds is what the New swatch shows.
    expect(last(calls.complete)).toBe("#00c248");
  });

  it("keeps a color outside sRGB when moving between the wide modes", async () => {
    const calls = await renderPicker("oklch(0.7 0.3 150)");
    await chooseMode("Display P3");
    expect(last(calls.complete)).toMatch(/^color\(display-p3 /);
    await chooseMode("OKLCH");
    // Mapped into Display P3 on the way, because color(display-p3) cannot
    // hold it, so it comes back inside P3.
    expect(last(calls.complete)).toMatch(/^oklch\(/);
  });
});

describe("editing in the wide modes", () => {
  it("writes typed OKLCH cells verbatim and keeps the other numbers as authored", async () => {
    const calls = await renderPicker("oklch(70% 0.1234 150.5)");
    await typeInto(field("L")!, "80");
    expect(last(calls.change)).toBe("oklch(80% 0.1234 150.5)");
    expect(last(calls.complete)).toBe("oklch(80% 0.1234 150.5)");
  });

  it("writes typed Display P3 channels as given", async () => {
    const calls = await renderPicker("color(display-p3 0.1 0.2 0.3)");
    await typeInto(field("G")!, "0.5");
    expect(last(calls.change)).toBe("color(display-p3 0.1 0.5 0.3)");
  });

  it("changes opacity without changing the notation or the authored numbers", async () => {
    const calls = await renderPicker("oklch(70% 0.1234 150.5)");
    await typeInto(field("Opacity")!, "40");
    expect(last(calls.change)).toBe("oklch(70% 0.1234 150.5 / 40%)");
  });

  it("does not rewrite a color when a cell is left unchanged", async () => {
    const calls = await renderPicker("oklch(70% 0.123456 150.5)");
    await typeInto(field("C")!, "0.123");
    expect(calls.change).toEqual([]);
    expect(calls.complete).toEqual([]);
  });

  it("writes the eyedropper's sRGB pick in the wide mode's notation", async () => {
    vi.stubGlobal(
      "EyeDropper",
      class {
        open() {
          return Promise.resolve({ sRGBHex: "#0a6bd6" });
        }
      },
    );
    const calls = await renderPicker("oklch(70% 0.3 150)");
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Pick color"]')!
        .click();
    });
    expect(last(calls.change)).toMatch(/^oklch\(54\.1%/);
    expect(last(calls.complete)).toMatch(/^oklch\(54\.1%/);
  });

  it("lists a wide document color as written and picks it in its own mode", async () => {
    const calls: Calls = { change: [], complete: [] };
    await act(async () =>
      root.render(
        <TooltipProvider>
          <DesignColorPicker
            value="#0a6bd6"
            open
            onOpenChange={() => {}}
            documentColors={["oklch(0.7 0.3 150)", "#ff0000"]}
            onChange={(next) => calls.change.push(next)}
            onChangeComplete={(next) => calls.complete.push(next)}
            trigger={<button type="button">Open picker</button>}
          />
        </TooltipProvider>,
      ),
    );
    const swatch = document.querySelector<HTMLButtonElement>(
      'button[aria-label="oklch(0.7 0.3 150)"]',
    )!;
    expect(swatch).not.toBeNull();
    await act(async () => swatch.click());
    // The authored numbers, written in the canonical spelling.
    expect(last(calls.change)).toBe("oklch(70% 0.3 150)");
    expect(trigger().textContent).toContain("OKLCH");
  });
});
