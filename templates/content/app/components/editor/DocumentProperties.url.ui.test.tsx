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

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useSetDocumentProperty: () => ({
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
  }),
}));

import {
  displayValue,
  propertyUrlHref,
  PropertyValuePopover,
} from "./DocumentProperties";

const reviewUrl =
  "https://content.agent-native.com/_agent-native/open?app=content&documentId=7n4Q5pN4U9J2";

function urlProperty(value: DocumentProperty["value"]): DocumentProperty {
  return {
    definition: {
      id: "review",
      databaseId: "database",
      name: "Review document",
      type: "url",
      visibility: "always_show",
      options: {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value,
    editable: true,
  };
}

describe("URL property values", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function renderCell(property: DocumentProperty) {
    act(() => {
      root.render(
        <PropertyValuePopover
          property={property}
          documentId="document"
          portalled={false}
        >
          {displayValue(property, undefined, "compact", {
            interactiveUrls: true,
          })}
        </PropertyValuePopover>,
      );
    });
    return {
      link: container.querySelector<HTMLAnchorElement>("a"),
      edit: container.querySelector<HTMLButtonElement>(
        'button[aria-label="Edit Review document"]',
      ),
    };
  }

  it("opens only http(s) addresses as links", () => {
    expect(propertyUrlHref(` ${reviewUrl} `)).toBe(reviewUrl);
    expect(propertyUrlHref("http://example.com/a")).toBe(
      "http://example.com/a",
    );
    expect(propertyUrlHref("javascript:alert(1)")).toBeNull();
    expect(propertyUrlHref("ftp://example.com/file")).toBeNull();
    expect(propertyUrlHref("example.com")).toBeNull();
    expect(propertyUrlHref(null)).toBeNull();
  });

  it("renders a web address as a link that opens in a new tab", () => {
    const { link } = renderCell(urlProperty(reviewUrl));
    expect(link?.getAttribute("href")).toBe(reviewUrl);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe(reviewUrl);
  });

  it("keeps the link outside the edit button and the editor closed when it is clicked", () => {
    const { link, edit } = renderCell(urlProperty(reviewUrl));
    expect(link?.closest('button, [role="button"]')).toBeNull();
    expect(edit).not.toBeNull();
    expect(edit?.contains(link)).toBe(false);

    act(() => {
      link?.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });
      link?.click();
    });
    expect(edit?.getAttribute("aria-expanded")).toBe("false");
  });

  it("edits the value from the rest of the cell or its edit button", () => {
    const { link, edit } = renderCell(urlProperty(reviewUrl));
    // The space around the link, inside the cell.
    act(() => link?.parentElement?.click());
    expect(edit?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('input[type="url"]')).not.toBeNull();

    act(() => edit?.click());
    expect(edit?.getAttribute("aria-expanded")).toBe("false");
    act(() => edit?.click());
    expect(edit?.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps anything else as plain text in a whole-cell edit button", () => {
    for (const value of ["example.com/review", "javascript:alert(1)"]) {
      const { link, edit } = renderCell(urlProperty(value));
      expect(link).toBeNull();
      expect(edit?.textContent).toBe(value);
    }
  });

  it("stays plain text where values aren't interactive", () => {
    act(() => {
      root.render(<>{displayValue(urlProperty(reviewUrl))}</>);
    });
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe(reviewUrl);
  });
});
