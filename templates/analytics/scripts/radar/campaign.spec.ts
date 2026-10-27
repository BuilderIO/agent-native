import { describe, expect, it } from "vitest";

import {
  campaignPostgresParams,
  summarizeCampaignByActivityApp,
  type CampaignFollowupResult,
} from "./campaign.ts";

describe("campaign follow-up summaries", () => {
  it("passes campaign recipients as a PostgreSQL JSONB value", () => {
    const params = campaignPostgresParams(
      [
        {
          email: "person@example.test",
          sent_at: "2026-10-26T12:00:00.000Z",
          app: "clips",
        },
      ],
      "2026-10-19",
      "2026-10-27",
      "org-1",
    );

    expect(JSON.parse(String(params[0]))).toEqual([
      {
        email: "person@example.test",
        sent_at: "2026-10-26T12:00:00.000Z",
        app: "clips",
      },
    ]);
  });

  it("aggregates recipient counts by activity app without repeating denominators", () => {
    const result: CampaignFollowupResult = {
      campaign: "outage_recovery_20261026",
      sentRecipients: 5,
      skippedRows: 0,
      byRecipientApp: { design: 1, slides: 4 },
      observedAt: "2026-10-27T00:00:00.000Z",
      rows: [
        {
          period: "after_send",
          recipient_app: "slides",
          activity_app: "slides",
          metric: "any_visit",
          recipients: 4,
          recipients_with_activity: 1,
        },
        {
          period: "after_send",
          recipient_app: "slides",
          activity_app: "slides",
          metric: "campaign_landing",
          recipients: 4,
          recipients_with_activity: 1,
        },
        {
          period: "after_send",
          recipient_app: "slides",
          activity_app: "slides",
          metric: "builder_connect_succeeded",
          recipients: 4,
          recipients_with_activity: 0,
        },
        {
          period: "after_send",
          recipient_app: "slides",
          activity_app: "slides",
          metric: "first_output",
          recipients: 4,
          recipients_with_activity: 0,
        },
        {
          period: "after_send",
          recipient_app: "design",
          activity_app: "slides",
          metric: "any_visit",
          recipients: 1,
          recipients_with_activity: 0,
        },
        {
          period: "after_send",
          recipient_app: "design",
          activity_app: "slides",
          metric: "campaign_landing",
          recipients: 1,
          recipients_with_activity: 0,
        },
        {
          period: "after_send",
          recipient_app: "design",
          activity_app: "slides",
          metric: "builder_connect_succeeded",
          recipients: 1,
          recipients_with_activity: 1,
        },
        {
          period: "after_send",
          recipient_app: "design",
          activity_app: "slides",
          metric: "first_output",
          recipients: 1,
          recipients_with_activity: 1,
        },
      ],
    };

    expect(summarizeCampaignByActivityApp(result)).toEqual([
      {
        period: "after_send",
        activityApp: "slides",
        recipients: 5,
        anyVisit: 1,
        campaignLanding: 1,
        builderConnectSucceeded: 1,
        firstOutput: 1,
      },
    ]);
  });
});
