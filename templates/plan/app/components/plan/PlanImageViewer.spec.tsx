// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PlanImageViewer } from "./PlanImageViewer";

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

describe("PlanImageViewer", () => {
  it("renders the image with a hover zoom button and a three-dots menu", () => {
    render(
      <PlanImageViewer src="https://cdn.example.com/cat.png" alt="A cat" />,
    );

    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/cat.png");
    expect(img?.getAttribute("alt")).toBe("A cat");

    // The root must be a <span> so it stays valid inside the <p> that
    // react-markdown wraps standalone images in (SSR/hydration safety).
    expect(container.firstElementChild?.tagName).toBe("SPAN");

    expect(
      container.querySelector('[aria-label="View full size"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[aria-label="Image options"]'),
    ).toBeTruthy();
  });

  it("shows an uploading placeholder instead of the image while uploading", () => {
    render(<PlanImageViewer src="" alt="A cat" uploading />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("Uploading image");
  });

  it("opens a full-size lightbox when the zoom button is clicked", () => {
    render(
      <PlanImageViewer src="https://cdn.example.com/cat.png" alt="A cat" />,
    );

    const zoom = container.querySelector(
      '[aria-label="View full size"]',
    ) as HTMLButtonElement;
    act(() => zoom.click());

    // The lightbox portals to <body> with its own toolbar; the "Fit" /
    // "Actual size" zoom label only exists inside the lightbox.
    expect(document.body.textContent).toContain("Fit to screen");
    expect(
      document.body.querySelector('[aria-label="Download image"]'),
    ).toBeTruthy();
  });

  it("keeps edit inside the same ⋯ group — no separate edit button — when onEdit is given", () => {
    render(
      <PlanImageViewer
        src="https://cdn.example.com/cat.png"
        alt="A cat"
        onEdit={() => {}}
        onReplace={() => {}}
      />,
    );

    // The hover action group must contain exactly two buttons: the zoom button
    // and the ⋯ options trigger. The edit affordance lives INSIDE the ⋯ menu, so
    // it must not add a third (separate) button — matching inline markdown images.
    const actions = container.querySelector(".plan-image__actions");
    expect(actions).toBeTruthy();
    expect(actions!.querySelectorAll("button")).toHaveLength(2);
    expect(
      container.querySelector('[aria-label="View full size"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[aria-label="Image options"]'),
    ).toBeTruthy();
  });

  it("renders a full-width block layout when `block` is set", () => {
    render(
      <PlanImageViewer
        src="https://cdn.example.com/wide.png"
        alt=""
        block
        imgClassName="object-contain"
      />,
    );

    const span = container.firstElementChild as HTMLElement;
    expect(span.className).toContain("w-full");
  });
});
