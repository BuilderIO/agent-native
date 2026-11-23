import { runFullReport } from "../../google-analytics.js";
import { ga4ConfigFingerprint } from "../config.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import { lastSucceededContentRun, listContentItems } from "../store.js";
import { BUILDER_BLOG_ORIGIN } from "./builder-blog.js";
import {
  collectionWindow,
  DailyMetricValues,
  pageKey,
  type ItemRef,
} from "./daily-metrics.js";

export const DAILY_DEV_SESSIONS_METRIC = "daily_dev_sessions";
const LOOKBACK_DAYS = 3;
const MAX_REPORT_ROWS = 100_000;

const TAGGED_LANDING = "[?&]via=dailydev(&|#|$)";
export const DAILY_DEV_SOURCE = "([a-z0-9-]+[.])*daily[.-]?dev";

export const dailyDevStep: ContentStep = {
  id: "daily_dev",
  async run({ collection, now, signal }) {
    const propertyId = collection.config.ga4.propertyId;
    if (!propertyId) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "ga4_property_not_configured",
        errorMessage:
          "daily.dev visits come from the blog's GA4 property. Set ga4PropertyId with configure-content-collection.",
      });
    }
    const configFingerprint = ga4ConfigFingerprint(propertyId);
    const previous = await lastSucceededContentRun(collection, "daily_dev");
    const articles = await listContentItems(collection, "builder_blog");
    if (articles.length === 0) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "no_content_items",
        errorMessage:
          "No blog articles are collected yet, so there are no pages to count daily.dev visits for.",
      });
    }
    const byKey = new Map<string, ItemRef>();
    for (const article of articles) {
      const key = article.url ? pageKey(article.url) : null;
      if (key) byKey.set(key, article);
    }

    const blog = new URL(BUILDER_BLOG_ORIGIN);
    const window = await collectionWindow(
      collection,
      "daily_dev",
      now,
      LOOKBACK_DAYS,
      configFingerprint,
    );
    const rows = await runFullReport({
      propertyId,
      dimensions: ["date", "landingPagePlusQueryString"],
      metrics: ["sessions"],
      dateRange: window,
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "hostName",
                stringFilter: { matchType: "EXACT", value: blog.hostname },
              },
            },
            {
              filter: {
                fieldName: "landingPagePlusQueryString",
                stringFilter: {
                  matchType: "BEGINS_WITH",
                  value: blog.pathname,
                },
              },
            },
            {
              orGroup: {
                expressions: [
                  {
                    filter: {
                      fieldName: "landingPagePlusQueryString",
                      stringFilter: {
                        matchType: "PARTIAL_REGEXP",
                        value: TAGGED_LANDING,
                      },
                    },
                  },
                  {
                    filter: {
                      fieldName: "sessionSource",
                      stringFilter: {
                        matchType: "FULL_REGEXP",
                        value: DAILY_DEV_SOURCE,
                        caseSensitive: false,
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      maxRows: MAX_REPORT_ROWS,
      ...(signal ? { signal } : {}),
    });

    const values = new DailyMetricValues();
    for (const row of rows) {
      const [day, landing] = row.dimensionValues.map(({ value }) => value);
      const [sessions] = row.metricValues.map(({ value }) => value);
      if (!day || !landing || !sessions) continue;
      const date = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
      const key = pageKey(`${blog.origin}${landing}`);
      const article = key ? byKey.get(key) : undefined;
      if (!article) continue;
      values.add(article, date, DAILY_DEV_SESSIONS_METRIC, Number(sessions));
    }

    const snapshots = values.snapshots({
      items: articles,
      metrics: [DAILY_DEV_SESSIONS_METRIC],
      startDate: window.startDate,
      lastReturnedDate: window.endDate,
    });
    return {
      snapshots,
      replaceSnapshots: previous?.configFingerprint !== configFingerprint,
      outcome: {
        rowCount: snapshots.length,
        windowStart: window.startDate,
        windowEnd: window.endDate,
        configFingerprint,
      },
    };
  },
};
