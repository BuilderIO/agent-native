import {
  SSR_HTML_CONTENT_TYPE,
  SSR_QUERY_CACHE_KEY_HEADER,
} from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import { loader as localeLoader } from "../app/routes/$locale";
import { loader as localizedDocsLoader } from "../app/routes/docs.$locale.$slug";
import { loader as docsSlugLoader } from "../app/routes/docs.$slug";
import { loader as corePhilosophyLoader } from "../app/routes/docs.core-philosophy";
import { loader as databaseAdaptersLoader } from "../app/routes/docs.database-adapters";
import { loader as templatesLoader } from "../app/routes/templates";

function captureRedirect(run: () => unknown): Response {
  try {
    run();
  } catch (error) {
    return error as Response;
  }
  throw new Error("Expected the route loader to throw a redirect response");
}

async function captureAsyncRedirect(
  run: () => Promise<unknown>,
): Promise<Response> {
  try {
    await run();
  } catch (error) {
    return error as Response;
  }
  throw new Error("Expected the route loader to throw a redirect response");
}

function expectHtmlRedirect(
  response: Response,
  status: number,
  location: string,
) {
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(status);
  expect(response.headers.get("location")).toBe(location);
  expect(response.headers.get("content-type")).toBe(SSR_HTML_CONTENT_TYPE);
}

describe("public docs redirects", () => {
  it("marks locale and slug aliases as shared-cacheable HTML", async () => {
    const localized = await captureAsyncRedirect(() =>
      localizedDocsLoader({
        params: { locale: "en-US", slug: "key-concepts" },
        request: new Request(
          "https://www.agent-native.com/en-US/docs/key-concepts",
        ),
        url: new URL("https://www.agent-native.com/en-US/docs/key-concepts"),
      } as Parameters<typeof localizedDocsLoader>[0]),
    );
    expectHtmlRedirect(localized, 301, "/docs/key-concepts");

    const locale = captureRedirect(() =>
      localeLoader({
        params: { locale: "en-US" },
        url: new URL("https://www.agent-native.com/en-US/docs/key-concepts"),
      } as Parameters<typeof localeLoader>[0]),
    );
    expectHtmlRedirect(locale, 301, "/docs/key-concepts");

    const legacySlug = await captureAsyncRedirect(() =>
      docsSlugLoader({
        params: { slug: "fr-FR" },
      } as Parameters<typeof docsSlugLoader>[0]),
    );
    expectHtmlRedirect(legacySlug, 302, "/fr-FR/docs");
  });

  it("marks public docs aliases and template paths as shared-cacheable HTML", () => {
    const corePhilosophy = corePhilosophyLoader(
      {} as Parameters<typeof corePhilosophyLoader>[0],
    );
    expectHtmlRedirect(corePhilosophy, 302, "/docs/key-concepts");

    const databaseAdapters = databaseAdaptersLoader(
      {} as Parameters<typeof databaseAdaptersLoader>[0],
    );
    expectHtmlRedirect(databaseAdapters, 302, "/docs/deployment");

    const templates = captureRedirect(() =>
      templatesLoader({
        request: new Request(
          "https://www.agent-native.com/templates/mail?source=docs",
        ),
      } as Parameters<typeof templatesLoader>[0]),
    );
    expectHtmlRedirect(templates, 301, "/apps/mail?source=docs");
    expect(templates.headers.get(SSR_QUERY_CACHE_KEY_HEADER)).toBe("query");
  });
});
