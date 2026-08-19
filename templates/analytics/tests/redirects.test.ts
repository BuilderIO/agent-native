import { SSR_QUERY_CACHE_VARIATION_HEADER } from "@agent-native/core/shared";
import { describe, expect, it } from "vitest";

import {
  clientLoader as rootClientLoader,
  loader as rootLoader,
} from "../app/routes/_index";
import {
  clientLoader as adhocClientLoader,
  loader as adhocLoader,
} from "../app/routes/adhoc.$id";
import {
  clientLoader as dashboardClientLoader,
  loader as dashboardLoader,
} from "../app/routes/dashboard";
import {
  clientLoader as overviewClientLoader,
  loader as overviewLoader,
} from "../app/routes/overview";
import {
  clientLoader as trafficClientLoader,
  loader as trafficLoader,
} from "../app/routes/traffic";

type RouteLoader = (args: never) => unknown;

function responseFrom(routeLoader: RouteLoader, args: unknown): Response {
  try {
    return routeLoader(args as never) as Response;
  } catch (error) {
    return error as Response;
  }
}

function expectHtmlRedirect(
  routeLoader: RouteLoader,
  args: unknown,
  location: string,
) {
  const response = responseFrom(routeLoader, args);
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(location);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get(SSR_QUERY_CACHE_VARIATION_HEADER)).toBe("query");
}

describe("Analytics redirect routes", () => {
  it.each([
    [
      rootLoader,
      { url: new URL("https://analytics.example/?from=home") },
      "/ask?from=home",
    ],
    [
      rootClientLoader,
      { url: new URL("https://analytics.example/?from=home") },
      "/ask?from=home",
    ],
    [
      adhocLoader,
      {
        params: { id: "dash 1" },
        url: new URL("https://analytics.example/adhoc/dash%201?tab=2"),
      },
      "/dashboards/dash%201?tab=2",
    ],
    [
      adhocClientLoader,
      {
        params: { id: "dash 1" },
        url: new URL("https://analytics.example/adhoc/dash%201?tab=2"),
      },
      "/dashboards/dash%201?tab=2",
    ],
    [
      dashboardLoader,
      { url: new URL("https://analytics.example/dashboard?tab=2") },
      "/?tab=2",
    ],
    [
      dashboardClientLoader,
      { url: new URL("https://analytics.example/dashboard?tab=2") },
      "/?tab=2",
    ],
    [
      overviewLoader,
      { url: new URL("https://analytics.example/overview?tab=2") },
      "/ask?tab=2",
    ],
    [
      overviewClientLoader,
      { url: new URL("https://analytics.example/overview?tab=2") },
      "/ask?tab=2",
    ],
    [
      trafficLoader,
      { url: new URL("https://analytics.example/traffic?tab=2") },
      "/dashboards/agent-native-templates-first-party?tab=2",
    ],
    [
      trafficClientLoader,
      { url: new URL("https://analytics.example/traffic?tab=2") },
      "/dashboards/agent-native-templates-first-party?tab=2",
    ],
  ] as const)(
    "keeps %s eligible for the shared HTML cache",
    (routeLoader, args, location) => {
      expectHtmlRedirect(routeLoader, args, location);
    },
  );
});
