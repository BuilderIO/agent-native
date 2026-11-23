import { expect, it } from "vitest";

import {
  clampSearchText,
  PROJECT_LIST_SEARCH_MAX_LENGTH,
} from "./search-limits";

it("trims, then cuts a query to the action's limit", () => {
  expect(clampSearchText("  rev  ", PROJECT_LIST_SEARCH_MAX_LENGTH)).toBe(
    "rev",
  );
  const cut = clampSearchText(
    "x".repeat(PROJECT_LIST_SEARCH_MAX_LENGTH + 50),
    PROJECT_LIST_SEARCH_MAX_LENGTH,
  );
  expect(cut).toHaveLength(PROJECT_LIST_SEARCH_MAX_LENGTH);
});
