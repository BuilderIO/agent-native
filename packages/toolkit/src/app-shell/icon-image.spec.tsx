// @vitest-environment happy-dom
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NavigationModel, ShellIconReference } from "./contracts.js";
import { HouseSidebar } from "./house-frames.js";
import {
  captureShellSnapshot,
  compareShellSnapshots,
  type ShellSemanticSnapshot,
} from "./shell-testing.js";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(icon: ShellIconReference) {
  const model: NavigationModel = {
    entries: [
      {
        id: "account",
        part: "sidebar",
        subPart: "sidebar.item",
        containerId: "footer",
        order: 0,
        kind: "identity",
        label: "Account",
        icon,
      },
    ],
    sections: [],
    presentation: {
      collapsed: { value: false },
      mobileOpen: { value: false },
      peekOpen: false,
      profile: "default",
      themeFamily: "house",
      visibility: "visible",
      width: 244,
    },
  };
  act(() => root.render(<HouseSidebar model={model} effects={[]} />));
}
function image() {
  const node = host.querySelector("img");
  expect(node).not.toBeNull();
  if (!node) throw new Error("Missing image");
  return node;
}
const fallbacks: ShellIconReference[] = [
  { kind: "initial", text: "AB" },
  { kind: "entity", key: "account", fallbackText: "AB" },
  { kind: "symbol", key: "account" },
];
describe("house icon images", () => {
  it.each(["", "Account portrait"])("preserves source and alt %j", (alt) => {
    render({
      kind: "initial",
      text: "AB",
      image: { src: "/portrait.svg", alt },
    });
    const img = image();
    expect(img.getAttribute("src")).toBe("/portrait.svg");
    expect(img.getAttribute("alt")).toBe(alt);
    expect(img.closest('[aria-hidden="true"]') !== null).toBe(alt === "");
    expect(img.width).toBe(20);
    expect(img.height).toBe(20);
    act(() => {
      fireEvent.load(img);
    });
    expect(img.style.opacity).toBe("1");
  });
  it.each(fallbacks)(
    "keeps the $kind fallback and fixed slot on load failure",
    (fallback) => {
      render({
        ...fallback,
        image: { src: "/missing.svg", alt: "Account portrait" },
      });
      const img = image();
      const slot = img.parentElement;
      if (!slot) throw new Error("Missing icon slot");
      const slotClasses = slot.className;
      expect(slotClasses).toContain("size-5");
      expect(slotClasses).toContain("shrink-0");
      expect(img.style.opacity).toBe("0");
      act(() => {
        fireEvent.error(img);
      });
      expect(img.style.opacity).toBe("0");
      expect(img.parentElement).toBe(slot);
      expect(slot.className).toBe(slotClasses);
      expect(img.getAttribute("alt")).toBe("Account portrait");
      const visualFallback = slot.querySelector("span");
      expect(visualFallback?.classList.contains("invisible")).toBe(false);
      expect(visualFallback?.querySelector("svg") != null).toBe(
        fallback.kind === "symbol",
      );
      expect(visualFallback?.textContent).toBe(
        fallback.kind === "symbol" ? "" : "AB",
      );
    },
  );
  it("resets load state when the source changes, including after failure", () => {
    const icon: ShellIconReference = {
      kind: "initial",
      text: "AB",
      image: { src: "/one.svg", alt: "" },
    };
    render(icon);
    act(() => {
      fireEvent.error(image());
    });
    render({ ...icon, image: { src: "/two.svg", alt: "New portrait" } });
    expect(image().getAttribute("src")).toBe("/two.svg");
    expect(image().style.opacity).toBe("0");
    act(() => {
      fireEvent.load(image());
    });
    expect(image().style.opacity).toBe("1");
    render({ ...icon, image: { src: "/three.svg", alt: "" } });
    expect(image().style.opacity).toBe("0");
    render({ kind: "initial", text: "CD" });
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("CD");
  });
  it("uses the fallback without requesting an empty source", () => {
    render({ kind: "initial", text: "AB", image: { src: "", alt: "" } });
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("AB");
  });
});

const snapshot = (): ShellSemanticSnapshot => ({
  id: "account",
  part: "sidebar.item",
  containerId: "footer",
  order: 0,
  present: true,
  family: "structure",
  role: null,
  expanded: null,
  name: "Account",
  value: null,
  choices: [],
  enabled: true,
  selected: null,
  checked: null,
  shortcut: null,
  badge: null,
  effect: { kind: "none", target: null, result: null },
  read: { status: "ready", message: null, recovery: null },
  action: { pending: false, error: null, recovery: null },
  keyboard: { reachable: false, operable: false },
});
function capture(markup: string) {
  const dom = document.createElement("div");
  dom.innerHTML = `<span data-rid="account" data-part="sidebar.item">${markup}</span>`;
  return captureShellSnapshot(dom, {
    visible: (element) => !element.closest("[hidden],[inert]"),
    observe: (_identity, elements) => ({
      ...snapshot(),
      images: [...elements[0].querySelectorAll("img")].map((img) => ({
        alt: img.getAttribute("alt"),
      })),
    }),
  });
}
describe("image equivalence observations", () => {
  it.each(["", "Account portrait"])(
    "detects image presence with alt %j in either direction",
    (alt) => {
      const withImage = capture(`<img src="/portrait.svg" alt="${alt}">`);
      const withoutImage = capture("AB");
      expect(
        compareShellSnapshots(withImage, withoutImage).differences,
      ).toContain('["account",null]: images');
      expect(
        compareShellSnapshots(withoutImage, withImage).differences,
      ).toContain('["account",null]: images');
    },
  );
  it.each([null, "Changed portrait", " Account portrait "])(
    "compares the exact text alternative %j",
    (alt) => {
      const a = { ...snapshot(), images: [{ alt: "Account portrait" }] };
      const b = { ...snapshot(), images: [{ alt }] };
      expect(compareShellSnapshots([a], [b]).differences).toContain(
        '["account",null]: images',
      );
    },
  );
  it("ignores URL and pixels and preserves legacy snapshots without images", () => {
    expect(
      compareShellSnapshots(
        capture('<img src="/one.svg" alt="">'),
        capture('<img src="/two.png" alt="">'),
      ).differences,
    ).toEqual([]);
    expect(
      compareShellSnapshots([snapshot()], [{ ...snapshot(), images: [] }])
        .differences,
    ).toEqual([]);
    expect(
      compareShellSnapshots(
        [{ ...snapshot(), images: undefined }],
        [snapshot()],
      ).differences,
    ).toEqual([]);
  });
  it("does not waive image differences for a registered control family change", () => {
    expect(
      compareShellSnapshots(
        [
          {
            ...snapshot(),
            family: "button",
            role: "button",
            images: [{ alt: "" }],
          },
        ],
        [{ ...snapshot(), family: "link", role: "link", images: [] }],
        {
          lookChoices: [
            {
              id: "account",
              sourceFamily: "button",
              houseFamily: "link",
              reason: "Native link",
            },
          ],
        },
      ).differences,
    ).toContain('["account",null]: images');
  });
});
