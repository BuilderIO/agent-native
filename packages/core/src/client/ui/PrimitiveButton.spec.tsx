// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isGhostEmphasis,
  resolvePrimitiveButtonEmphasis,
  PrimitiveButton,
} from "./PrimitiveButton.js";

describe("PrimitiveButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  describe("resolvePrimitiveButtonEmphasis helper", () => {
    it("respects explicitly passed emphasis", () => {
      expect(resolvePrimitiveButtonEmphasis("solid")).toBe("solid");
      expect(resolvePrimitiveButtonEmphasis("ghost")).toBe("ghost");
      expect(resolvePrimitiveButtonEmphasis("outline")).toBe("outline");
      expect(resolvePrimitiveButtonEmphasis("subtle")).toBe("subtle");
      expect(resolvePrimitiveButtonEmphasis("contrast")).toBe("contrast");
      expect(resolvePrimitiveButtonEmphasis("ghost-inset")).toBe("ghost-inset");
    });

    it("derives emphasis from variant when emphasis is undefined", () => {
      expect(resolvePrimitiveButtonEmphasis(undefined, "default")).toBe(
        "solid",
      );
      expect(resolvePrimitiveButtonEmphasis(undefined, "destructive")).toBe(
        "solid",
      );
      expect(resolvePrimitiveButtonEmphasis(undefined, "secondary")).toBe(
        "solid",
      );
      expect(resolvePrimitiveButtonEmphasis(undefined, "outline")).toBe(
        "outline",
      );
      expect(resolvePrimitiveButtonEmphasis(undefined, "ghost")).toBe("ghost");
      expect(resolvePrimitiveButtonEmphasis(undefined, "ghost-inset")).toBe(
        "ghost",
      );
      expect(resolvePrimitiveButtonEmphasis(undefined, "link")).toBe("ghost");
    });

    it("defaults to ghost when neither is specified", () => {
      expect(resolvePrimitiveButtonEmphasis()).toBe("ghost");
      expect(resolvePrimitiveButtonEmphasis(undefined, undefined)).toBe(
        "ghost",
      );
    });
  });

  describe("isGhostEmphasis helper", () => {
    it("returns true when emphasis is ghost or ghost-inset", () => {
      expect(isGhostEmphasis("ghost")).toBe(true);
      expect(isGhostEmphasis("ghost-inset")).toBe(true);
    });

    it("returns false when emphasis is solid, outline, subtle, or contrast", () => {
      expect(isGhostEmphasis("solid")).toBe(false);
      expect(isGhostEmphasis("outline")).toBe(false);
      expect(isGhostEmphasis("subtle")).toBe(false);
      expect(isGhostEmphasis("contrast")).toBe(false);
    });

    it("resolves from variant when emphasis is undefined", () => {
      expect(isGhostEmphasis(undefined, "ghost")).toBe(true);
      expect(isGhostEmphasis(undefined, "ghost-inset")).toBe(true);
      expect(isGhostEmphasis(undefined, "link")).toBe(true);
      expect(isGhostEmphasis(undefined, "default")).toBe(false);
      expect(isGhostEmphasis(undefined, "destructive")).toBe(false);
      expect(isGhostEmphasis(undefined, "outline")).toBe(false);
      expect(isGhostEmphasis(undefined, "secondary")).toBe(false);
    });

    it("defaults to true (ghost) when neither emphasis nor variant is provided", () => {
      expect(isGhostEmphasis()).toBe(true);
      expect(isGhostEmphasis(undefined, undefined)).toBe(true);
    });
  });

  describe("rendering and class application", () => {
    it("does NOT apply hover:text-inherit or hover:bg-transparent for solid primary buttons", async () => {
      await act(async () => {
        root.render(
          <PrimitiveButton
            intent="primary"
            emphasis="solid"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Save changes
          </PrimitiveButton>,
        );
      });

      const button = container.querySelector("button");
      expect(button).not.toBeNull();
      const classList = button!.className.split(/\s+/);

      expect(classList).toContain("text-primary-foreground");
      expect(classList).toContain("bg-primary");
      expect(classList).not.toContain("hover:text-inherit");
      expect(classList).not.toContain("hover:bg-transparent");
    });

    it("applies hover:text-inherit and hover:bg-transparent for ghost-emphasis buttons", async () => {
      await act(async () => {
        root.render(
          <PrimitiveButton
            intent="neutral"
            emphasis="ghost"
            className="text-xs text-muted-foreground"
          >
            Ghost action
          </PrimitiveButton>,
        );
      });

      const button = container.querySelector("button");
      expect(button).not.toBeNull();
      const classList = button!.className.split(/\s+/);

      expect(classList).toContain("hover:text-inherit");
      expect(classList).toContain("hover:bg-transparent");
    });

    it("applies hover:text-inherit for default (unspecified emphasis/variant) primitive buttons", async () => {
      await act(async () => {
        root.render(
          <PrimitiveButton aria-label="More information">
            <span>Info</span>
          </PrimitiveButton>,
        );
      });

      const button = container.querySelector("button");
      expect(button).not.toBeNull();
      const classList = button!.className.split(/\s+/);

      expect(classList).toContain("hover:text-inherit");
      expect(classList).toContain("hover:bg-transparent");
    });

    it("does NOT apply hover:text-inherit for outline buttons", async () => {
      await act(async () => {
        root.render(
          <PrimitiveButton
            intent="neutral"
            emphasis="outline"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </PrimitiveButton>,
        );
      });

      const button = container.querySelector("button");
      expect(button).not.toBeNull();
      const classList = button!.className.split(/\s+/);

      expect(classList).not.toContain("hover:text-inherit");
      expect(classList).toContain("hover:text-foreground");
    });

    it("preserves text-primary-foreground on hover simulation under navy brand theme", async () => {
      container.style.setProperty("--primary", "hsl(217, 91%, 60%)");
      container.style.setProperty("--primary-foreground", "hsl(0, 0%, 100%)");
      container.style.setProperty("--card-foreground", "hsl(222, 47%, 11%)");

      await act(async () => {
        root.render(
          <div className="bg-card text-card-foreground">
            <PrimitiveButton
              intent="primary"
              emphasis="solid"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Confirm
            </PrimitiveButton>
          </div>,
        );
      });

      const button = container.querySelector("button")!;
      expect(button).not.toBeNull();

      const classList = button.className.split(/\s+/);
      expect(classList).toContain("text-primary-foreground");
      expect(classList).not.toContain("hover:text-inherit");
      expect(classList).not.toContain("text-card-foreground");
    });
  });
});
