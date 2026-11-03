import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import SearchRoute from "../routes/search.js";
import type { SearchEverythingResponse } from "./brain.js";

const mocks = vi.hoisted(() => ({ useActionQuery: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    key === "common.incompleteTranscript"
      ? `Incomplete transcript: ${values?.count}`
      : key,
}));

describe("search result completeness warnings", () => {
  it.each([
    { provider: "zoom", legacy: true, count: undefined, warning: "?" },
    { provider: "slack", legacy: true, count: undefined, warning: null },
    { provider: "zoom", legacy: false, count: undefined, warning: "?" },
    { provider: "zoom", legacy: false, count: null, warning: "?" },
    { provider: "zoom", legacy: false, count: 0, warning: null },
    { provider: "zoom", legacy: false, count: 3, warning: "3" },
    { provider: "slack", legacy: false, count: null, warning: "?" },
    {
      provider: "zoom",
      legacy: false,
      type: "source",
      count: undefined,
      warning: null,
    },
  ])(
    "renders $provider legacy=$legacy count=$count as warning=$warning",
    ({ provider, legacy, type = "knowledge", count, warning }) => {
      const row = {
        id: "knowledge",
        title: "Product roadmap",
        summary: "Product ships Monday.",
        status: "published" as const,
      };
      const response: SearchEverythingResponse = legacy
        ? { knowledge: [{ ...row, sourceType: provider }] }
        : {
            results: [
              {
                ...row,
                type,
                provider,
                ...(count === undefined ? {} : { withheldPassages: count }),
              },
            ],
          };
      mocks.useActionQuery.mockImplementation((name: string) => ({
        data: name === "search-everything" ? response : { projects: [] },
        isLoading: false,
        isError: false,
      }));
      const html = renderToStaticMarkup(
        <MemoryRouter initialEntries={["/search?q=product"]}>
          <SearchRoute />
        </MemoryRouter>,
      );
      expect(html).toContain("Product roadmap");
      if (warning === null) {
        expect(html).not.toContain("Incomplete transcript:");
      } else {
        expect(html).toContain(`Incomplete transcript: ${warning}`);
      }
    },
  );
});
