import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/store.js";
import { injectAnalyticsIntoHtml, wrapWithAnalytics } from "./analytics.js";
import { runWithRequestContext } from "./request-context.js";

const previousGaMeasurementId = process.env.GA_MEASUREMENT_ID;
const previousBakedGaMeasurementId =
  process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID;
const previousGtmContainerId = process.env.GTM_CONTAINER_ID;
const previousBakedGtmContainerId =
  process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID;
const previousAgentNativeAnalyticsPublicKey =
  process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
const previousViteAgentNativeAnalyticsPublicKey =
  process.env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
const previousAgentNativeAnalyticsEndpoint =
  process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT;

beforeEach(() => {
  resetAppConfigForTests();
});

afterEach(() => {
  resetAppConfigForTests();
  if (previousGaMeasurementId === undefined) {
    delete process.env.GA_MEASUREMENT_ID;
  } else {
    process.env.GA_MEASUREMENT_ID = previousGaMeasurementId;
  }
  if (previousBakedGaMeasurementId === undefined) {
    delete process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID;
  } else {
    process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID =
      previousBakedGaMeasurementId;
  }
  if (previousGtmContainerId === undefined) {
    delete process.env.GTM_CONTAINER_ID;
  } else {
    process.env.GTM_CONTAINER_ID = previousGtmContainerId;
  }
  if (previousBakedGtmContainerId === undefined) {
    delete process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID;
  } else {
    process.env.AGENT_NATIVE_BUILD_GTM_CONTAINER_ID =
      previousBakedGtmContainerId;
  }
  if (previousAgentNativeAnalyticsPublicKey === undefined) {
    delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  } else {
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY =
      previousAgentNativeAnalyticsPublicKey;
  }
  if (previousViteAgentNativeAnalyticsPublicKey === undefined) {
    delete process.env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  } else {
    process.env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY =
      previousViteAgentNativeAnalyticsPublicKey;
  }
  if (previousAgentNativeAnalyticsEndpoint === undefined) {
    delete process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT;
  } else {
    process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT =
      previousAgentNativeAnalyticsEndpoint;
  }
});

function streamFromString(value: string): ReadableStream<Uint8Array> {
  return streamFromChunks([value]);
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

describe("wrapWithAnalytics", () => {
  it("passes SSR HTML through when GA is not configured", async () => {
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GTM_CONTAINER_ID;

    const html = await readStream(
      wrapWithAnalytics(streamFromString("<html><head></head><body /></html>")),
    );

    expect(html).toBe("<html><head></head><body /></html>");
  });

  it("injects the configured GA measurement id before </head>", async () => {
    process.env.GA_MEASUREMENT_ID = "G-UNITTEST123";
    delete process.env.GTM_CONTAINER_ID;

    const html = await readStream(
      wrapWithAnalytics(streamFromString("<html><head></head><body /></html>")),
    );

    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-UNITTEST123",
    );
    expect(html).toContain(`gtag('config',"G-UNITTEST123")`);
    expect(html).toContain(
      'window.__AGENT_NATIVE_SYNTHETIC_TRAFFIC__!=="beta-e2e"',
    );
    expect(html.indexOf("googletagmanager.com")).toBeLessThan(
      html.indexOf("</head>"),
    );
  });

  it("uses the build-baked GA measurement id when runtime env is absent", async () => {
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GTM_CONTAINER_ID;
    process.env.AGENT_NATIVE_BUILD_GA_MEASUREMENT_ID = "G-BAKED123";

    const html = await readStream(
      wrapWithAnalytics(streamFromString("<html><head></head><body /></html>")),
    );

    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-BAKED123",
    );
    expect(html).toContain(`gtag('config',"G-BAKED123")`);
  });

  it("injects GTM in the head, behind targeting consent", async () => {
    process.env.GTM_CONTAINER_ID = "gtm-unit123";
    process.env.GA_MEASUREMENT_ID = "G-IGNORED123";

    const html = await readStream(
      wrapWithAnalytics(
        streamFromString(
          "<html><head></head><body><main>ok</main></body></html>",
        ),
      ),
    );

    expect(html).toContain("https://www.googletagmanager.com/gtm.js?id='+i+dl");
    expect(html).toContain('"GTM-UNIT123"');
    expect(html).toContain(
      'window.__AGENT_NATIVE_SYNTHETIC_TRAFFIC__!=="beta-e2e"',
    );
    expect(html).toContain('.push(["targeting",(function(){');
    expect(html.indexOf("data-agent-native-consent-mode")).toBeLessThan(
      html.indexOf("gtm.js"),
    );
    expect(html).not.toContain("<noscript>");
    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-IGNORED123&l=__AGENT_NATIVE_GA_DATA_LAYER__",
    );
    expect(html).toContain("window.__AGENT_NATIVE_GA_GTAG__=agentNativeGtag;");
    expect(html).toContain(
      "agentNativeGtag('config',\"G-IGNORED123\",{send_page_view:false});",
    );
    expect(html).not.toContain("gtag('config',\"G-IGNORED123\")");
    expect(html.indexOf("data-agent-native-consent")).toBeLessThan(
      html.indexOf("</head>"),
    );
  });

  it("handles head and body tags split across SSR chunks", async () => {
    process.env.GTM_CONTAINER_ID = "GTM-CHUNKED123";

    const html = await readStream(
      wrapWithAnalytics(
        streamFromChunks([
          "<html><head><title>App</title></he",
          "ad><bo",
          "dy><main>ok</main></body></html>",
        ]),
      ),
    );

    expect(html.match(/googletagmanager\.com\/gtm\.js/g)).toHaveLength(1);
    expect(html.indexOf("gtm.js")).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain("<body><main>ok</main>");
  });
});

describe("injectAnalyticsIntoHtml", () => {
  it("keeps analytics injection invariant for synthetic traffic", () => {
    process.env.GA_MEASUREMENT_ID = "G-UNITTEST123";
    process.env.GTM_CONTAINER_ID = "GTM-AUTH123";
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_test";

    const source = "<html><head></head><body>synthetic</body></html>";
    const normal = injectAnalyticsIntoHtml(source);
    const synthetic = runWithRequestContext({ isSyntheticTraffic: true }, () =>
      injectAnalyticsIntoHtml(source),
    );

    expect(synthetic).toBe(normal);
  });

  it("injects first-party analytics config for public auth events", () => {
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_auth_test";
    process.env.AGENT_NATIVE_ANALYTICS_ENDPOINT =
      "https://analytics.example.test/track";
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GTM_CONTAINER_ID;

    const html = injectAnalyticsIntoHtml(
      "<html><head></head><body>signup</body></html>",
    );

    expect(html).toContain("data-agent-native-analytics-config");
    expect(html).toContain('"agentNativeAnalyticsPublicKey":"anpk_auth_test"');
    expect(html).toContain(
      '"agentNativeAnalyticsEndpoint":"https://analytics.example.test/track"',
    );
    expect(html).toContain('"authSessionReplay":false');
    expect(html.indexOf("data-agent-native-analytics-config")).toBeLessThan(
      html.indexOf("</head>"),
    );
  });

  it("projects the auth replay opt-in only when Analytics has a public key", () => {
    process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = "anpk_auth_test";
    delete process.env.GA_MEASUREMENT_ID;
    delete process.env.GTM_CONTAINER_ID;
    defineAppConfig({ analytics: { authSessionReplay: true } });

    const html = injectAnalyticsIntoHtml(
      "<html><head></head><body>signup</body></html>",
    );

    expect(html).toContain('"authSessionReplay":true');

    delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
    const withoutKey = injectAnalyticsIntoHtml(
      "<html><head></head><body>signup</body></html>",
    );
    expect(withoutKey).not.toContain("data-agent-native-analytics-config");
    expect(withoutKey).not.toContain('"authSessionReplay":true');
  });

  it("injects the configured analytics scripts into auth HTML", () => {
    process.env.GA_MEASUREMENT_ID = "G-UNITTEST123";
    delete process.env.GTM_CONTAINER_ID;

    const html = injectAnalyticsIntoHtml(
      "<html><head></head><body>signup</body></html>",
    );

    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=G-UNITTEST123",
    );
    expect(html.indexOf("googletagmanager.com")).toBeLessThan(
      html.indexOf("</head>"),
    );
  });

  it("injects no GTM noscript iframe, which couldn't wait for consent", () => {
    process.env.GTM_CONTAINER_ID = "GTM-AUTH123";

    const html = injectAnalyticsIntoHtml(
      "<html><head></head><body>signup</body></html>",
    );

    expect(html).not.toContain("ns.html");
    expect(html).toContain("<body>signup</body>");
  });
});

describe("consent bootstrap", () => {
  /** Run the injected head scripts in a page with this visitor's state. */
  async function loadPage({
    region = "unknown",
    timeZone = "America/Los_Angeles",
    cookie = "",
    cachedRegion,
  }: {
    region?: string;
    timeZone?: string;
    cookie?: string;
    cachedRegion?: string;
  }) {
    process.env.GTM_CONTAINER_ID = "GTM-PAGE123";
    process.env.GA_MEASUREMENT_ID = "G-PAGE123";
    const html = injectAnalyticsIntoHtml(
      "<html><head></head><body></body></html>",
    );
    const loaded: string[] = [];
    const fetched: string[] = [];
    const session = new Map<string, string>(
      cachedRegion ? [["an_consent_region", cachedRegion]] : [],
    );
    const script = () => ({
      set src(value: string) {
        loaded.push(value);
      },
    });
    const head = { appendChild: (el: { src?: string }) => el };
    const window: Record<string, unknown> = {
      sessionStorage: {
        getItem: (key: string) => session.get(key) ?? null,
        setItem: (key: string, value: string) => session.set(key, value),
      },
    };
    const context = {
      window,
      document: {
        cookie,
        head,
        createElement: script,
        getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
      },
      Intl: {
        DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }),
      },
      fetch: async (url: string) => {
        fetched.push(url);
        return { ok: true, json: async () => ({ region }) };
      },
      sessionStorage: window.sessionStorage,
      Date,
    };
    window.window = window;
    for (const [, body] of html.matchAll(
      /<script[^>]*>([\s\S]*?)<\/script>/g,
    )) {
      runInNewContext(body!, context);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    const tags = loaded.map((src) =>
      src.includes("gtm.js") ? "gtm" : src.includes("gtag/js") ? "ga" : src,
    );
    const consent = (layer = "dataLayer") =>
      ((window[layer] ?? []) as ArrayLike<unknown>[])
        .filter((entry) => entry[0] === "consent")
        .map((entry) => [entry[1], entry[2]]);
    return { tags, loaded, fetched, session, window, consent };
  }

  const granted = (performance: boolean, targeting: boolean) => {
    const value = (on: boolean) => (on ? "granted" : "denied");
    return {
      analytics_storage: value(performance),
      ad_storage: value(targeting),
      ad_user_data: value(targeting),
      ad_personalization: value(targeting),
    };
  };

  it("loads every tag outside the consent region", async () => {
    const page = await loadPage({ region: "none" });

    expect(page.tags.sort()).toEqual(["ga", "gtm"]);
    expect(page.fetched).toEqual(["/_agent-native/auth/consent-region"]);
    expect(page.session.get("an_consent_region")).toBe("none");
    expect(page.consent()).toEqual([
      ["default", granted(false, false)],
      ["update", granted(true, true)],
    ]);
  });

  it("holds every tag in the consent region until the visitor chooses", async () => {
    const page = await loadPage({ region: "consent" });

    expect(page.tags).toEqual([]);
    expect(page.window.__AN_CONSENT_QUEUE__).toHaveLength(2);
    expect(page.consent("__AGENT_NATIVE_GA_DATA_LAYER__")).toEqual([
      ["default", granted(false, false)],
      ["update", granted(false, false)],
    ]);
  });

  it("loads each tag once, however often consent is given again", async () => {
    const page = await loadPage({ region: "consent" });
    const [[, loadGtm]] = page.window.__AN_CONSENT_QUEUE__ as [
      string,
      () => void,
    ][];

    loadGtm!();
    loadGtm!();

    expect(page.loaded).toHaveLength(1);
  });

  it("falls back to the time zone when the server can't tell", async () => {
    expect((await loadPage({ timeZone: "Europe/Berlin" })).tags).toEqual([]);
    expect((await loadPage({ timeZone: "Europe/London" })).tags).toHaveLength(
      2,
    );
  });

  it("follows a stored choice at once, without asking the server", async () => {
    const page = await loadPage({
      region: "consent",
      cookie: "theme=dark; an_consent=1.p1.t0",
    });

    expect(page.tags).toEqual(["ga"]);
    expect(page.fetched).toEqual([]);
    expect(page.consent()).toEqual([
      ["default", granted(true, false)],
      ["update", granted(true, false)],
    ]);
  });

  it("reuses the region already known this session", async () => {
    const page = await loadPage({ cachedRegion: "none", region: "consent" });

    expect(page.tags).toHaveLength(2);
    expect(page.fetched).toEqual([]);
  });
});
