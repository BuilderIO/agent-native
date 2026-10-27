// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { useContainHorizontalOverscroll } from "./use-contain-horizontal-overscroll";

const PROPERTY = "overscroll-behavior-x";
const read = (element: HTMLElement) => element.style.getPropertyValue(PROPERTY);

function Probe() {
  useContainHorizontalOverscroll();
  return null;
}

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Probe />);
  });
  return {
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

afterEach(() => {
  document.documentElement.style.removeProperty(PROPERTY);
  document.body.style.removeProperty(PROPERTY);
});

describe("useContainHorizontalOverscroll", () => {
  it("keeps a horizontal swipe from reaching browser history while it is mounted", async () => {
    const view = await mount();

    expect(read(document.documentElement)).toBe("none");
    expect(read(document.body)).toBe("none");

    await view.unmount();
  });

  it("leaves the rest of the app alone once it unmounts", async () => {
    const view = await mount();
    await view.unmount();

    expect(read(document.documentElement)).toBe("");
    expect(read(document.body)).toBe("");
  });

  it("restores a value the page already had", async () => {
    document.documentElement.style.setProperty(PROPERTY, "contain");

    const view = await mount();
    expect(read(document.documentElement)).toBe("none");
    await view.unmount();

    expect(read(document.documentElement)).toBe("contain");
  });
});
