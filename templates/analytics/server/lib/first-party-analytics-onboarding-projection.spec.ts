import { describe, expect, it } from "vitest";

import {
  ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS,
  FirstPartyAnalyticsUnsupportedSqlError,
  renderFirstPartyAnalyticsBigQueryRequestSql,
  renderFirstPartyAnalyticsBigQuerySql,
} from "./first-party-analytics-backend.js";
import { scopedAnalyticsSql } from "./first-party-analytics.js";
import type {
  OnboardingJourneyEventsFilters,
  OnboardingJourneyObservationWindow,
} from "./first-party-metric-catalog.js";
import { buildOnboardingJourneyEventPageRequest } from "./onboarding-journey.js";

const table = {
  projectId: "example-project",
  datasetId: "analytics",
  tableId: "events",
  fullyQualified: "example-project.analytics.events",
};

const filters: OnboardingJourneyEventsFilters = {
  dateFrom: "2026-09-24",
  dateTo: "2026-10-08",
  app: "all",
  emailFilter: "all",
};

const observation: OnboardingJourneyObservationWindow = {
  observationCutoff: "2026-10-09T00:00:00.000Z",
  observationDate: "2026-10-09",
};

describe("onboarding journey event source projection", () => {
  it("projects the real second page while retaining scope, date, and receipt semantics", () => {
    const request = buildOnboardingJourneyEventPageRequest(
      filters,
      8_000,
      4_000,
      observation,
      false,
    );
    const scope = scopedAnalyticsSql(
      request.sql,
      { userEmail: "owner@example.test", orgId: "org_test" },
      "2026-10-09",
      {
        scopedEventsSingleScan: true,
        scopedEventsProjection: "onboarding_journey",
      },
    );
    const rendered = renderFirstPartyAnalyticsBigQueryRequestSql(
      scope.sql,
      scope.args,
      table,
      {
        eventDateRange: request.eventDateRange,
        scopedEventsSingleScan: true,
        scopedEventsProjection: "onboarding_journey",
      },
    );
    const projectedColumns = ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS.join(", ");

    expect(ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS).toHaveLength(14);
    expect(request).toMatchObject({ limit: 4_000, offset: 4_000 });
    expect(request.eventDateRange).toEqual({
      startDate: "2026-09-24",
      endDate: "2026-10-08",
    });
    expect(
      rendered.match(/FROM `example-project\.analytics\.events`/g),
    ).toHaveLength(1);
    expect(rendered).toContain(
      "SELECT " +
        projectedColumns +
        " FROM `example-project.analytics.events` WHERE",
    );
    expect(rendered).toContain(
      "(org_id = 'org_test' OR (org_id IS NULL AND owner_email = 'owner@example.test'))",
    );
    expect(rendered).toContain("event_date >= DATE '2026-09-24'");
    expect(rendered).toContain("event_date <= DATE '2026-10-08'");
    expect(rendered).toContain(
      "QUALIFY ROW_NUMBER() OVER (PARTITION BY id, org_id ORDER BY received_at DESC) = 1",
    );
    expect(rendered).toContain("LIMIT 4000 OFFSET 4000");
    expect(rendered).toMatch(/LIMIT 5000$/);
  });

  it("keeps the default source projection unchanged for other callers", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT id FROM analytics_events WHERE event_name = 'signup'",
      { userEmail: "owner@example.test", orgId: "org_test" },
      "2026-10-09",
    );

    expect(scoped.sql).toContain("SELECT * FROM analytics_events");
    expect(scoped.sql).not.toContain(
      `SELECT ${ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS.join(", ")} FROM analytics_events`,
    );
  });

  it("fails closed when the opted-in raw source has an unexpected projection", () => {
    const scoped = scopedAnalyticsSql(
      "SELECT id FROM analytics_events WHERE event_name = 'signup'",
      { userEmail: "owner@example.test", orgId: "org_test" },
      "2026-10-09",
      {
        scopedEventsSingleScan: true,
        scopedEventsProjection: "onboarding_journey",
      },
    );
    const expectedSelection = `SELECT ${ONBOARDING_JOURNEY_EVENT_SOURCE_COLUMNS.join(", ")} FROM analytics_events`;
    const unexpectedSql = scoped.sql.replace(
      expectedSelection,
      "SELECT id, event_name FROM analytics_events",
    );

    expect(unexpectedSql).not.toBe(scoped.sql);
    try {
      renderFirstPartyAnalyticsBigQueryRequestSql(
        unexpectedSql,
        scoped.args,
        table,
        { scopedEventsProjection: "onboarding_journey" },
      );
      throw new Error(
        "Expected the unexpected event projection to be rejected",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(FirstPartyAnalyticsUnsupportedSqlError);
      expect(error).toMatchObject({
        construct: "an unsupported onboarding journey event source projection",
        message:
          "First-party BigQuery query cannot safely apply the onboarding journey event projection and deduplication",
      });
      expect((error as Error).message).not.toContain("owner@example.test");
    }
  });

  it.each([
    [
      "string literal",
      "SELECT 'SELECT * FROM `example-project.analytics.events` WHERE true' AS note",
    ],
    [
      "comment",
      "SELECT 1 /* SELECT * FROM `example-project.analytics.events` WHERE true */",
    ],
  ])("does not treat raw source text in a %s as a source", (_kind, sql) => {
    const rendered = renderFirstPartyAnalyticsBigQuerySql(sql, [], table, {
      scopedEventsProjection: "onboarding_journey",
    });

    expect(rendered).not.toContain("QUALIFY ROW_NUMBER()");
  });
});
