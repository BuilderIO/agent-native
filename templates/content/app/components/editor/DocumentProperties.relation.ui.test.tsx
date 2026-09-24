// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) => {
    if (key === "editor.properties.editProperty") {
      return `Edit ${String(options?.name)}`;
    }
    return key;
  },
}));

import { PropertyValuePopover } from "./DocumentProperties";

const relationProperty: DocumentProperty = {
  definition: {
    id: "related",
    databaseId: "database",
    name: "Related",
    type: "relation",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: ["page-1"],
  editable: true,
};

describe("relation property value trigger", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PropertyValuePopover
          property={relationProperty}
          documentId="document"
          portalled={false}
        >
          <a href="/page-1" onClick={(event) => event.preventDefault()}>
            Linked page
          </a>
        </PropertyValuePopover>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps relation links outside button semantics", () => {
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.closest('button, [role="button"]')).toBeNull();

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Related"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.contains(link)).toBe(false);
  });

  it("does not open the picker when a relation link is clicked", () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Related"]',
    );
    act(() => container.querySelector("a")?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });
});
