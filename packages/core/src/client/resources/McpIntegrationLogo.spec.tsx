// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpIntegrationLogo } from "./McpIntegrationLogo.js";

describe("McpIntegrationLogo", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("does not render the monogram while a logo is loading", () => {
    act(() => {
      root.render(
        <McpIntegrationLogo
          name="Amplitude"
          logoUrl="data:image/svg+xml,<svg />"
        />,
      );
    });

    expect(container.querySelector("img")).toBeTruthy();
    expect(container.textContent).toBe("");
  });

  it("shows the monogram only after the logo fails", () => {
    act(() => {
      root.render(
        <McpIntegrationLogo
          name="Amplitude"
          logoUrl="data:image/svg+xml,<svg />"
        />,
      );
    });

    const image = container.querySelector("img");
    expect(image).toBeTruthy();

    act(() => {
      image?.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("A");
  });

  it("keeps the logo plate on the page surface", () => {
    act(() => {
      root.render(
        <McpIntegrationLogo
          name="Amplitude"
          logoUrl="data:image/svg+xml,<svg />"
        />,
      );
    });

    expect(container.firstElementChild?.className).toContain("bg-background");
    expect(container.firstElementChild?.className).not.toContain(
      "dark:bg-foreground",
    );
  });

  it("inverts dark brand marks only when the catalog marks them for contrast", () => {
    act(() => {
      root.render(
        <McpIntegrationLogo
          name="Notion"
          logoUrl="data:image/svg+xml,<svg />"
          integrationId="notion"
        />,
      );
    });

    expect(container.querySelector("img")?.className).toContain("dark:invert");
    expect(container.querySelector("img")?.className).toContain(
      "dark:hue-rotate-180",
    );
  });

  it("preserves color for brand marks that do not need dark-mode correction", () => {
    act(() => {
      root.render(
        <McpIntegrationLogo
          name="Slack"
          logoUrl="data:image/svg+xml,<svg />"
          integrationId="slack"
        />,
      );
    });

    expect(container.querySelector("img")?.className).not.toContain(
      "dark:invert",
    );
  });
});
