import { SSR_QUERY_CACHE_KEY_HEADER } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import { loader as brandKitsLoader } from "../app/routes/brand-kits._index";
import { loader as librariesLoader } from "../app/routes/libraries";
import { loader as pickerLoader } from "../app/routes/picker";

function expectLibraryRedirect(
  routeLoader: (args: never) => Response,
  args: unknown,
) {
  const response = routeLoader(args as never);

  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/library?from=home");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get(SSR_QUERY_CACHE_KEY_HEADER)).toBe("query");
}

describe("Assets legacy redirects", () => {
  it.each([
    [pickerLoader, { url: new URL("https://assets.example/picker?from=home") }],
    [
      brandKitsLoader,
      { request: new Request("https://assets.example/brand-kits?from=home") },
    ],
    [
      librariesLoader,
      { request: new Request("https://assets.example/libraries?from=home") },
    ],
  ] as const)(
    "keeps %s eligible for the shared HTML cache",
    (routeLoader, args) => {
      expectLibraryRedirect(routeLoader, args);
    },
  );
});
