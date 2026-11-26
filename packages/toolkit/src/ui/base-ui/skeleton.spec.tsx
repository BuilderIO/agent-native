// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton.js";

afterEach(cleanup);

describe("Skeleton part", () => {
  it("is hidden from assistive technology and can't take focus", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const skeleton = container.querySelector(".skeleton");
    expect(skeleton?.tagName).toBe("DIV");
    expect(skeleton?.getAttribute("aria-hidden")).toBe("true");
    expect(skeleton?.getAttribute("tabindex")).toBe("-1");
    expect(skeleton?.hasAttribute("inert")).toBe(true);
    const classes = skeleton ? [...skeleton.classList].sort() : null;
    expect(classes).toEqual(["h-4", "skeleton", "w-32"]);
  });

  it("wraps text inline, in the text's shape", () => {
    const { container } = render(<Skeleton>Ada Lovelace</Skeleton>);
    const skeleton = container.querySelector(".skeleton");
    expect(skeleton?.tagName).toBe("SPAN");
    expect(skeleton?.hasAttribute("data-inline-skeleton")).toBe(true);
    expect(skeleton?.textContent).toBe("Ada Lovelace");
  });

  it("becomes the element it wraps", () => {
    const { container } = render(
      <Skeleton>
        <img className="photo" src="https://example.com/ada.png" alt="" />
      </Skeleton>,
    );
    const image = container.querySelector("img");
    expect(image?.classList.contains("skeleton")).toBe(true);
    expect(image?.classList.contains("photo")).toBe(true);
    expect(image?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders its children in place of the skeleton while not loading", () => {
    const { container } = render(
      <Skeleton loading={false}>
        <button type="button">Save</button>
      </Skeleton>,
    );
    expect(container.querySelector(".skeleton")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).not.toBeNull();
  });
});
