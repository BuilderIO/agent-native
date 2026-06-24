import { describe, expect, it } from "vitest";
import { loader as localizedDocsIndexLoader } from "../routes/docs.$locale._index";
import { loader as localizedDocLoader } from "../routes/docs.$locale.$slug";
import {
  buildSearchIndexAsync,
  hasLocalizedDoc,
  loadDoc,
} from "./docs-content";
import { getDocsNavItems } from "./docsNavItems";

function loaderArgs(params: Record<string, string>) {
  return {
    context: {},
    params,
    request: new Request("https://docs.test/docs"),
  } as never;
}

describe("localized docs fallback", () => {
  it("redirects missing localized markdown to the English canonical route", async () => {
    expect(hasLocalizedDoc("fr-FR", "getting-started")).toBe(false);

    const doc = await loadDoc("getting-started", "fr-FR");
    expect(doc).toBeUndefined();

    let response: Response | undefined;
    try {
      await localizedDocLoader(
        loaderArgs({ locale: "fr-FR", slug: "getting-started" }),
      );
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/docs");
  });

  it("loads localized markdown when an override exists", async () => {
    expect(hasLocalizedDoc("fr-FR", "internationalization")).toBe(true);

    const doc = await loadDoc("internationalization", "fr-FR");
    expect(doc?.slug).toBe("internationalization");

    const loaderDoc = await localizedDocLoader(
      loaderArgs({ locale: "fr-FR", slug: "internationalization" }),
    );
    expect(loaderDoc?.slug).toBe("internationalization");
  });

  it("redirects localized docs index to the canonical route for the target doc", () => {
    let response: Response | undefined;
    try {
      localizedDocsIndexLoader(loaderArgs({ locale: "fr-FR" }));
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/docs");
  });

  it("uses localized nav links only for translated pages", () => {
    const items = getDocsNavItems("fr-FR");

    expect(items.find((item) => item.id === "getting-started")?.to).toBe(
      "/docs",
    );
    expect(items.find((item) => item.id === "creating-templates")?.to).toBe(
      "/docs/creating-templates",
    );
    expect(items.find((item) => item.id === "internationalization")?.to).toBe(
      "/docs/fr-FR/internationalization",
    );
  });

  it("keeps untranslated docs searchable at English canonical paths", async () => {
    const index = await buildSearchIndexAsync("fr-FR");

    expect(
      index.some(
        (entry) =>
          entry.path === "/docs" &&
          entry.page.toLowerCase().includes("getting started"),
      ),
    ).toBe(true);
    expect(
      index.some((entry) => entry.path === "/docs/fr-FR/internationalization"),
    ).toBe(true);
  });
});
