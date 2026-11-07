// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VisualFontFamilyPicker } from "./font-family.js";
import {
  type GoogleFontCatalogEntry,
  type GoogleFontCatalogState,
  resetGoogleFontsForTests,
} from "./google-fonts.js";

const entry = (family: string, weights = [400]): GoogleFontCatalogEntry => ({
  family,
  category: "Sans Serif",
  weights,
  italicWeights: [],
  variable: false,
});

const options = [
  { value: "sans-serif", label: "Sans Serif" },
  { value: "'Inter', sans-serif", label: "Inter" },
  { value: "'Poppins', sans-serif", label: "Poppins" },
];

const labels = {
  documentFonts: "In this deck",
  allFonts: "All fonts",
  catalogUnavailable: "Couldn't load the full font library",
};

function renderPicker(
  catalog: GoogleFontCatalogState,
  onChange = vi.fn(),
  documentFonts: string[] = [],
) {
  render(
    <VisualFontFamilyPicker
      label="Font"
      value="'Inter', sans-serif"
      options={options}
      onChange={onChange}
      mixedLabel="Mixed"
      searchable
      searchPlaceholder="Search fonts"
      catalog={catalog}
      documentFonts={documentFonts}
      labels={labels}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Font" }));
  return onChange;
}

const optionNames = () =>
  screen.getAllByRole("option").map((option) => option.textContent);

const fontFaceLoads: Array<() => void> = [];
let deferFaceLoads = false;

class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: string,
  ) {}
  load() {
    if (!deferFaceLoads) return Promise.resolve(this);
    return new Promise<this>((resolve) =>
      fontFaceLoads.push(() => resolve(this)),
    );
  }
}

/** Families named in each css2 request so far. */
const requestedFamilies = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.flatMap((call: unknown[]) =>
    new URL(String(call[0])).searchParams
      .getAll("family")
      .map((family) => family.split(":")[0] ?? ""),
  );

function css2Response(url: string) {
  const families = new URL(url).searchParams
    .getAll("family")
    .map((family) => family.split(":")[0] ?? "");
  return new Response(
    families
      .map(
        (family) =>
          `@font-face { font-family: '${family}'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/l/font?kit=${encodeURIComponent(family)}) format('woff2'); }`,
      )
      .join("\n"),
  );
}

const flush = () =>
  act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  fetchMock = vi.fn(async (url: string) => css2Response(url));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: vi.fn() },
  });
  deferFaceLoads = false;
  fontFaceLoads.length = 0;
});

afterEach(() => {
  cleanup();
  resetGoogleFontsForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("VisualFontFamilyPicker searchable", () => {
  it("lists the whole catalog after document fonts and filters by search", () => {
    renderPicker(
      {
        status: "ready",
        fonts: [entry("Inter"), entry("Lobster"), entry("Roboto Mono")],
      },
      vi.fn(),
      ["Lobster", "sans-serif"],
    );
    expect(screen.getByText("In this deck")).toBeTruthy();
    expect(screen.getByText("All fonts")).toBeTruthy();
    expect(optionNames()).toEqual([
      "Lobster",
      "Sans Serif",
      "Inter",
      "Lobster",
      "Roboto Mono",
    ]);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "mono" },
    });
    expect(optionNames()).toEqual(["Roboto Mono", "mono"]);
  });

  it("windows a large catalog instead of rendering every row", () => {
    const fonts = Array.from({ length: 1800 }, (_, index) =>
      entry(`Family ${index}`),
    );
    renderPicker({ status: "ready", fonts });
    expect(screen.getAllByRole("option").length).toBeLessThan(40);
  });

  it("draws a row in its own face only after its preview loads", async () => {
    deferFaceLoads = true;
    renderPicker({
      status: "ready",
      fonts: [entry("Lobster"), entry("Inter")],
    });
    const lobster = () =>
      document.querySelector<HTMLElement>('[data-font-family="Lobster"] span');
    expect(lobster()?.style.fontFamily).toBe("");
    expect(lobster()?.className).toContain("text-muted-foreground");

    await flush();
    expect(requestedFamilies(fetchMock)).toContain("Lobster");
    expect(
      new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("text"),
    ).toBe("ILbenorst");
    await act(async () => {
      for (const resolve of fontFaceLoads.splice(0)) resolve();
      await Promise.resolve();
    });
    await flush();
    expect(lobster()?.style.fontFamily).toContain(
      "Lobster Font Picker Preview",
    );
    expect(lobster()?.className).not.toContain("text-muted-foreground");
  });

  it("warms the first rows when the trigger is hovered, before it opens", async () => {
    render(
      <VisualFontFamilyPicker
        label="Font"
        value="'Inter', sans-serif"
        options={options}
        onChange={vi.fn()}
        mixedLabel="Mixed"
        searchable
        catalog={{ status: "ready", fonts: [entry("Inter"), entry("Lobster")] }}
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Font" }));
    await flush();
    expect(requestedFamilies(fetchMock)).toEqual(["Inter", "Lobster"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("requests faces several screens ahead of the scroll", async () => {
    const fonts = Array.from({ length: 1800 }, (_, index) =>
      entry(`Family ${index}`),
    );
    renderPicker({ status: "ready", fonts });
    await flush();
    // Rows 0-13 are on screen; the queue already holds screens further down.
    expect(requestedFamilies(fetchMock)).toContain("Family 55");
    expect(requestedFamilies(fetchMock)).not.toContain("Family 900");

    const listbox = screen.getByRole("listbox");
    listbox.scrollTop = 800 * 28;
    fireEvent.scroll(listbox);
    await flush();
    expect(requestedFamilies(fetchMock)).toContain("Family 800");
    expect(requestedFamilies(fetchMock)).toContain("Family 850");
    expect(requestedFamilies(fetchMock)).not.toContain("Family 1200");
  });

  it("keeps loaded faces across opens instead of fetching again", async () => {
    renderPicker({ status: "ready", fonts: [entry("Lobster"), entry("Lora")] });
    await flush();
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Font" }));
    await flush();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("fades a late face in, except under reduced motion", async () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    const loadLate = async (reduce: boolean) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({ matches: reduce })),
      );
      deferFaceLoads = true;
      renderPicker({ status: "ready", fonts: [entry("Lobster")] });
      await flush();
      await act(async () => {
        for (const resolve of fontFaceLoads.splice(0)) resolve();
        await Promise.resolve();
      });
      await flush();
      cleanup();
      resetGoogleFontsForTests();
    };
    await loadLate(true);
    expect(animate).not.toHaveBeenCalled();
    await loadLate(false);
    expect(animate).toHaveBeenCalledWith(
      [{ opacity: 0.35 }, { opacity: 1 }],
      expect.objectContaining({ duration: 120 }),
    );
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  it("keeps the static list and says so when the catalog fails", () => {
    renderPicker({ status: "error", error: new Error("offline") });
    expect(screen.getByRole("status").textContent).toBe(
      "Couldn't load the full font library",
    );
    expect(optionNames()).toEqual(["Sans Serif", "Inter", "Poppins"]);
  });

  it("shows no note while the catalog loads", () => {
    renderPicker({ status: "loading" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(optionNames()).toEqual(["Sans Serif", "Inter", "Poppins"]);
  });

  it("selects with the keyboard and offers a custom name", () => {
    const onChange = renderPicker({
      status: "ready",
      fonts: [entry("Inter"), entry("Lobster"), entry("Lora")],
    });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "lo" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("'Lora', sans-serif");

    fireEvent.click(screen.getByRole("button", { name: "Font" }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Brand Sans" },
    });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith('"Brand Sans", sans-serif');
  });
});
