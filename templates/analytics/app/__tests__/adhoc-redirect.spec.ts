import { describe, expect, it } from "vitest";
import { loader, clientLoader } from "../routes/adhoc.$id";

// `/adhoc/:id` is the legacy dashboard URL. It must permanently forward to the
// canonical `/dashboards/:id` while preserving query string and hash so old
// bookmarks and deep links (e.g. `?id=`, `?config=`, `#panel`) keep working.

function locationFromLoader(
  fn: typeof loader,
  url: string,
  id: string,
): string {
  try {
    fn({
      request: new Request(url),
      url: new URL(url),
      pattern: "/adhoc/:id",
      params: { id },
      context: {} as never,
    });
  } catch (thrown) {
    if (thrown instanceof Response) {
      return thrown.headers.get("Location") ?? "";
    }
    throw thrown;
  }
  throw new Error("expected the loader to throw a redirect Response");
}

describe("adhoc.$id legacy redirect", () => {
  it("redirects /adhoc/:id to /dashboards/:id", () => {
    expect(
      locationFromLoader(loader, "https://x.test/adhoc/sales", "sales"),
    ).toBe("/dashboards/sales");
  });

  it("preserves the query string", () => {
    expect(
      locationFromLoader(
        loader,
        "https://x.test/adhoc/explorer?config=abc123",
        "explorer",
      ),
    ).toBe("/dashboards/explorer?config=abc123");
  });

  it("preserves the query string and hash together", () => {
    expect(
      locationFromLoader(
        loader,
        "https://x.test/adhoc/explorer?id=42&tab=overview#panel-3",
        "explorer",
      ),
    ).toBe("/dashboards/explorer?id=42&tab=overview#panel-3");
  });

  it("encodes ids with special characters", () => {
    expect(
      locationFromLoader(
        loader,
        "https://x.test/adhoc/team%20a%2Fb",
        "team a/b",
      ),
    ).toBe("/dashboards/team%20a%2Fb");
  });

  it("uses the same redirect on the client loader", () => {
    expect(
      locationFromLoader(
        clientLoader,
        "https://x.test/adhoc/sales?range=30d",
        "sales",
      ),
    ).toBe("/dashboards/sales?range=30d");
  });
});
