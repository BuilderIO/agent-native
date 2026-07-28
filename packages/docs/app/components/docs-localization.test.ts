import { afterEach, describe, expect, it, vi } from "vitest";

import { loader as rootLoader, resolveLayoutLocale } from "../root";
import { loader as localizedDocLoader } from "../routes/docs.$locale.$slug";
import { loader as defaultDocLoader } from "../routes/docs.$slug";
import { loader as docsIndexLoader } from "../routes/docs._index";
import {
  buildSearchIndexAsync,
  hasLocalizedDoc,
  loadDoc,
} from "./docs-content";
import { docsMarkdownPathForPath } from "./docs-seo";
import { getDocsNavItems, getDocsNavSections } from "./docsNavItems";

function loaderArgs(
  params: Record<string, string>,
  url = "https://docs.test/docs",
) {
  return {
    context: {},
    params,
    request: new Request(url),
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localized docs fallback", () => {
  it("keeps unprefixed pages on the default SSR locale", () => {
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => (name === "lang" ? "ar-SA" : null),
      },
    });

    expect(resolveLayoutLocale("/apps")).toBe("en-US");
    expect(resolveLayoutLocale("/ar-SA/apps")).toBe("ar-SA");
  });

  it("keeps docs routes canonical to the URL locale", () => {
    vi.stubGlobal("document", {
      documentElement: {
        getAttribute: (name: string) => (name === "lang" ? "ar-SA" : null),
      },
    });

    expect(resolveLayoutLocale("/fr-FR/docs/internationalization")).toBe(
      "fr-FR",
    );
    expect(resolveLayoutLocale("/docs/fr-FR/internationalization")).toBe(
      "fr-FR",
    );
    expect(resolveLayoutLocale("/docs")).toBe("en-US");
  });

  it("loads localized getting started content on prefixed docs indexes", async () => {
    const doc = await docsIndexLoader(
      loaderArgs({ locale: "zh-CN" }, "https://docs.test/zh-CN/docs"),
    );

    expect(doc.slug).toBe("getting-started");
    expect(doc.title).toBe("开始使用");
  });

  it("loads localized markdown for every translated docs page", async () => {
    expect(hasLocalizedDoc("fr-FR", "getting-started")).toBe(true);

    const doc = await loadDoc("getting-started", "fr-FR");
    expect(doc?.slug).toBe("getting-started");

    const loaderDoc = await localizedDocLoader(
      loaderArgs({ locale: "fr-FR", slug: "getting-started" }),
    );
    expect(loaderDoc?.slug).toBe("getting-started");
  });

  it("loads localized markdown when an override exists", async () => {
    expect(hasLocalizedDoc("fr-FR", "internationalization")).toBe(true);

    const doc = await loadDoc("internationalization", "fr-FR");
    expect(doc?.slug).toBe("internationalization");

    const loaderDoc = await localizedDocLoader(
      loaderArgs(
        { locale: "fr-FR", slug: "internationalization" },
        "https://docs.test/fr-FR/docs/internationalization",
      ),
    );
    expect(loaderDoc?.slug).toBe("internationalization");
  });

  it("loads the renamed Agent Resources source for localized routes", async () => {
    expect(hasLocalizedDoc("fr-FR", "agent-resources")).toBe(true);
    expect(hasLocalizedDoc("fr-FR", "workspace")).toBe(false);

    const doc = await loadDoc("agent-resources", "fr-FR");
    expect(doc?.slug).toBe("agent-resources");
    expect(doc?.title).toBe("Ressources de l'agent");

    const loaderDoc = await localizedDocLoader(
      loaderArgs(
        { locale: "fr-FR", slug: "agent-resources" },
        "https://docs.test/fr-FR/docs/agent-resources",
      ),
    );
    expect(loaderDoc?.slug).toBe("agent-resources");
  });

  it("redirects localized docs index to the canonical route for the target doc", async () => {
    let response: Response | undefined;
    try {
      await defaultDocLoader(loaderArgs({ slug: "fr-FR" }));
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(302);
    expect(response?.headers.get("Location")).toBe("/fr-FR/docs");
  });

  it("loads default docs slugs instead of treating them as locales", async () => {
    const doc = await defaultDocLoader(loaderArgs({ slug: "agent-surfaces" }));

    expect(doc?.slug).toBe("agent-surfaces");
  });

  it.each(["workspace", "resources"])(
    "redirects the legacy %s slug to Agent Resources",
    async (slug) => {
      let response: Response | undefined;
      try {
        await defaultDocLoader(loaderArgs({ slug }));
      } catch (error) {
        response = error as Response;
      }

      expect(response?.status).toBe(301);
      expect(response?.headers.get("Location")).toBe("/docs/agent-resources");
    },
  );

  it.each([
    "/fr-FR/docs/workspace",
    "/docs/fr-FR/workspace",
    "/fr-FR/docs/resources",
  ])("preserves the locale when redirecting %s", async (url) => {
    let response: Response | undefined;
    try {
      await localizedDocLoader(
        loaderArgs(
          { locale: "fr-FR", slug: url.split("/").at(-1)! },
          `https://docs.test${url}`,
        ),
      );
    } catch (error) {
      response = error as Response;
    }

    expect(response?.status).toBe(301);
    expect(response?.headers.get("Location")).toBe(
      "/fr-FR/docs/agent-resources",
    );
  });

  it("uses localized nav links for the active docs locale", () => {
    const items = getDocsNavItems("fr-FR");

    expect(items.find((item) => item.id === "getting-started")?.to).toBe(
      "/fr-FR/docs",
    );
    expect(items.find((item) => item.id === "creating-templates")?.to).toBe(
      "/fr-FR/docs/creating-templates",
    );
    expect(items.find((item) => item.id === "internationalization")?.to).toBe(
      "/fr-FR/docs/internationalization",
    );
    const toolkitSection = getDocsNavSections("fr-FR").find(
      (section) => section.id === "toolkits",
    );
    expect(
      toolkitSection?.items.find((item) => item.id === "toolkit-ui")?.to,
    ).toBe("/fr-FR/docs/toolkit-ui");
    const resourcesSection = getDocsNavSections("fr-FR").find(
      (section) => section.id === "agent-resources",
    );
    expect(resourcesSection?.title).toBe("Agent Resources");
    expect(resourcesSection?.items[0]?.to).toBe("/fr-FR/docs/agent-resources");
  });

  it("indexes translated docs at localized canonical paths", async () => {
    const index = await buildSearchIndexAsync("fr-FR");

    expect(
      index.some(
        (entry) =>
          entry.path === "/fr-FR/docs" &&
          entry.page.toLowerCase().includes("démarrage"),
      ),
    ).toBe(true);
    expect(
      index.some((entry) => entry.path === "/fr-FR/docs/internationalization"),
    ).toBe(true);
  }, 60_000);

  it("points docs markdown alternates at existing markdown twins", () => {
    expect(docsMarkdownPathForPath("/docs/multi-app-workspace")).toBe(
      "/docs/multi-app-workspace.md",
    );
    expect(docsMarkdownPathForPath("/fr-FR/docs/internationalization")).toBe(
      "/fr-FR/docs/internationalization.md",
    );
    expect(docsMarkdownPathForPath("/fr-FR/docs/durable-background-runs")).toBe(
      "/docs/durable-background-runs.md",
    );
    expect(docsMarkdownPathForPath("/apps")).toBeNull();
  });

  it("hydrates route locale messages from the server for prefixed docs paths", async () => {
    const data = await rootLoader(
      loaderArgs({}, "https://docs.test/zh-CN/docs/internationalization"),
    );

    expect(data.locale).toBe("zh-CN");
    expect(data.preference.locale).toBe("zh-CN");
    expect(data.messages).toMatchObject({
      header: expect.objectContaining({ docs: expect.any(String) }),
    });
  });
});
