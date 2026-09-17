// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BuilderImage } from "./builder-image";

const cdnImage =
  "https://cdn.builder.io/api/v1/image/assets%2Fspace%2Fasset-id";

afterEach(() => {
  cleanup();
});

describe("BuilderImage", () => {
  it("uses the expanded srcset without a sizes hint", () => {
    const { container } = render(<BuilderImage src={cdnImage} alt="Preview" />);
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    expect(image?.getAttribute("sizes")).toBeNull();
    expect(image?.getAttribute("srcset")).toContain("width=1200 1200w");
    expect(image?.getAttribute("srcset")).toContain("width=2400 2400w");
  });
});
