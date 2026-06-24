import { describe, expect, it } from "vitest";
import { loader as localizedDocsIndexLoader } from "../routes/docs.$locale._index";
import { loader as localizedDocLoader } from "../routes/docs.$locale.$slug";
import { hasLocalizedDoc, loadDoc } from "./docs-content";
import { getDocsNavItems } from "./docsNavItems";

function loaderArgs(params: Record<string, string>) {
  return {
    context: {},
    params,
    request: new Request("https://docs.test/docs"),
  } as never;
}

describe("localized docs fallback", () => {
  it("loads English markdown inside a localized route when no override exists", async () => {
    expect(hasLocalizedDoc("fr-FR", "getting-started")).toBe(false);

    const doc = await loadDoc("getting-started", "fr-FR");
    expect(doc?.slug).toBe("getting-started");

    const loaderDoc = await localizedDocLoader(
      loaderArgs({ locale: "fr-FR", slug: "getting-started" }),
    );
    expect(loaderDoc?.slug).toBe("getting-started");
  });

  it("keeps localized docs index redirects on the requested locale route", () => {
    let response: Response | undefined;
    try {
      localizedDocsIndexLoader(loaderArgs({ locale: "fr-FR" }));
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe(
      "/docs/fr-FR/getting-started",
    );
  });

  it("keeps nav links in the active locale even for untranslated pages", () => {
    const items = getDocsNavItems("fr-FR");

    expect(items.find((item) => item.id === "getting-started")?.to).toBe(
      "/docs/fr-FR/getting-started",
    );
    expect(items.find((item) => item.id === "creating-templates")?.to).toBe(
      "/docs/fr-FR/creating-templates",
    );
    expect(items.find((item) => item.id === "internationalization")?.to).toBe(
      "/docs/fr-FR/internationalization",
    );
  });
});
