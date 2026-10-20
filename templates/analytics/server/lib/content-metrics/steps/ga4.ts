import { runFullReport } from "../../google-analytics.js";
import { ContentStepStop, type ContentStep } from "../step.js";
import { listContentItems } from "../store.js";
import { BUILDER_BLOG_ORIGIN } from "./builder-blog.js";
import {
  collectionWindow,
  DailyMetricValues,
  pageKey,
  type ItemRef,
} from "./daily-metrics.js";

export const GA4_PAGEVIEWS_METRIC = "ga4_pageviews";
/** GA4 settles a day's numbers within about two days; fetch three again. */
const LOOKBACK_DAYS = 3;
const MAX_REPORT_ROWS = 500_000;

function ga4Date(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** Daily GA4 pageviews for each collected Builder blog article. */
export const ga4Step: ContentStep = {
  id: "ga4",
  async run({ collection, now, signal }) {
    const articles = await listContentItems(collection, "builder_blog");
    if (articles.length === 0) {
      throw new ContentStepStop({
        status: "not_configured",
        errorCode: "no_content_items",
        errorMessage:
          "No blog articles are collected yet, so there are no pages to count pageviews for.",
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
      "ga4",
      now,
      LOOKBACK_DAYS,
    );
    const rows = await runFullReport({
      dimensions: ["date", "pagePath"],
      metrics: ["screenPageViews"],
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
                fieldName: "pagePath",
                stringFilter: {
                  matchType: "BEGINS_WITH",
                  value: blog.pathname,
                },
              },
            },
          ],
        },
      },
      maxRows: MAX_REPORT_ROWS,
      ...(signal ? { signal } : {}),
    });
    if (rows.length === 0) {
      // The blog always has readers, so an empty report means the property
      // is not the one that measures it. Recording that as a quiet window
      // would show zeros for every article.
      throw new Error(
        `The GA4 property returned no pageviews for ${blog.hostname}${blog.pathname} between ${window.startDate} and ${window.endDate}. Check which property GA4_PROPERTY_ID points at.`,
      );
    }

    const values = new DailyMetricValues();
    let lastReturnedDate: string | null = null;
    for (const row of rows) {
      const date = ga4Date(row.dimensionValues[0]!.value);
      if (!lastReturnedDate || date > lastReturnedDate) lastReturnedDate = date;
      const key = pageKey(`${blog.origin}${row.dimensionValues[1]!.value}`);
      const article = key ? byKey.get(key) : undefined;
      if (!article) continue;
      values.add(
        article,
        date,
        GA4_PAGEVIEWS_METRIC,
        Number(row.metricValues[0]!.value),
      );
    }

    const snapshots = values.snapshots({
      items: articles,
      metrics: [GA4_PAGEVIEWS_METRIC],
      startDate: window.startDate,
      lastReturnedDate,
    });
    return {
      snapshots,
      outcome: {
        rowCount: snapshots.length,
        windowStart: window.startDate,
        windowEnd: lastReturnedDate,
      },
    };
  },
};
