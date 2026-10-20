import { readFileSync } from "node:fs";

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
    expectHtmlRedirect(localized, 301, "/docs/key-concepts/");

    const locale = captureRedirect(() =>
      localeLoader({
        params: { locale: "en-US" },
        url: new URL("https://www.agent-native.com/en-US/docs/key-concepts"),
      } as Parameters<typeof localeLoader>[0]),
    );
    expectHtmlRedirect(locale, 301, "/docs/key-concepts/");

    const legacySlug = await captureAsyncRedirect(() =>
      docsSlugLoader({
        params: { slug: "fr-FR" },
      } as Parameters<typeof docsSlugLoader>[0]),
    );
    expectHtmlRedirect(legacySlug, 302, "/fr-fr/docs/");
  });

  it("marks public docs aliases and template paths as shared-cacheable HTML", () => {
    const corePhilosophy = corePhilosophyLoader(
      {} as Parameters<typeof corePhilosophyLoader>[0],
    );
    expectHtmlRedirect(corePhilosophy, 302, "/docs/key-concepts/");

    const databaseAdapters = databaseAdaptersLoader(
      {} as Parameters<typeof databaseAdaptersLoader>[0],
    );
    expectHtmlRedirect(databaseAdapters, 302, "/docs/deployment/");

    const templates = captureRedirect(() =>
      templatesLoader({
        request: new Request(
          "https://www.agent-native.com/templates/mail?source=docs",
        ),
      } as Parameters<typeof templatesLoader>[0]),
    );
    expectHtmlRedirect(templates, 301, "/apps/mail/?source=docs");
    expect(templates.headers.get(SSR_QUERY_CACHE_KEY_HEADER)).toBe("query");
  });
});

type NetlifyRedirect = { from: string; to: string; status: number };

function readNetlifyRedirects(): NetlifyRedirect[] {
  const toml = readFileSync(
    new URL("../netlify.toml", import.meta.url),
    "utf8",
  );
  return toml
    .split("[[redirects]]")
    .slice(1)
    .map((block) => {
      const field = (name: string) =>
        block.match(new RegExp(`^${name}\\s*=\\s*"?([^"\\n]*)"?`, "m"))?.[1];
      const from = field("from");
      const to = field("to");
      const status = Number(field("status"));
      if (!from || !to || !Number.isInteger(status)) {
        throw new Error(`Unparseable netlify.toml redirect: ${block.trim()}`);
      }
      return { from, to, status };
    });
}

// Netlify applies the first matching rule: `:name` matches one path segment
// and a trailing `*` matches the rest.
function resolveNetlifyRedirect(
  rules: NetlifyRedirect[],
  pathname: string,
): { to: string; status: number } | undefined {
  for (const rule of rules) {
    const params: Record<string, string> = {};
    const fromSegments = rule.from.split("/");
    const pathSegments = pathname.split("/");
    let matched = true;
    for (let index = 0; index < fromSegments.length; index++) {
      const pattern = fromSegments[index];
      if (pattern === "*") {
        params.splat = pathSegments.slice(index).join("/");
        break;
      }
      const segment = pathSegments[index];
      if (segment === undefined) {
        matched = false;
        break;
      }
      if (pattern.startsWith(":")) params[pattern.slice(1)] = segment;
      else if (pattern !== segment) {
        matched = false;
        break;
      }
      if (
        index === fromSegments.length - 1 &&
        pathSegments.length !== fromSegments.length
      ) {
        matched = false;
      }
    }
    if (!matched) continue;
    const to = rule.to.replace(/:(\w+)/g, (_, name: string) => params[name]);
    return { to, status: rule.status };
  }
  return undefined;
}

describe("netlify redirect rules", () => {
  it("never appends a slash directly after a splat", () => {
    const toml = readFileSync(
      new URL("../netlify.toml", import.meta.url),
      "utf8",
    );

    expect(toml).not.toMatch(/to\s*=\s*"[^"]*:splat\/"/);
  });

  it("sends Brain app and template URLs to the Brain docs", () => {
    const rules = readNetlifyRedirects();

    for (const pathname of [
      "/apps/brain",
      "/apps/brain/",
      "/templates/brain",
      "/templates/brain/",
    ]) {
      expect(resolveNetlifyRedirect(rules, pathname)).toEqual({
        to: "/docs/template-brain/",
        status: 301,
      });
    }
    for (const pathname of ["/es-es/apps/brain/", "/es-es/templates/brain"]) {
      expect(resolveNetlifyRedirect(rules, pathname)).toEqual({
        to: "/es-es/docs/template-brain/",
        status: 301,
      });
    }
  });

  it("sends /home to the homepage and keeps other template paths on /apps/", () => {
    const rules = readNetlifyRedirects();

    expect(resolveNetlifyRedirect(rules, "/home")).toEqual({
      to: "/",
      status: 301,
    });
    expect(resolveNetlifyRedirect(rules, "/home/")).toEqual({
      to: "/",
      status: 301,
    });
    expect(resolveNetlifyRedirect(rules, "/templates/mail")).toEqual({
      to: "/apps/mail",
      status: 301,
    });
    expect(resolveNetlifyRedirect(rules, "/apps/mail/")).toBeUndefined();
  });
});
