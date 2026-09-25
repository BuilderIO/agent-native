/**
 * Catalog entries for the transactional emails Analytics sends.
 *
 * Registered from `server/plugins/transactional-emails.ts` so Dispatch can list
 * and preview them without the app having sent anything yet.
 */

import { defineTransactionalEmail } from "@agent-native/core/email-catalog";
import { emailStrong, renderEmail } from "@agent-native/core/server";

export const ANALYTICS_DASHBOARD_REPORT_EMAIL_ID = "analytics.dashboard-report";

let registered = false;

export function registerAnalyticsEmails(): void {
  if (registered) return;
  registered = true;

  defineTransactionalEmail({
    id: ANALYTICS_DASHBOARD_REPORT_EMAIL_ID,
    name: "Scheduled dashboard report",
    trigger:
      "A dashboard report subscription comes due and at least one panel produced usable data. A run where every queried panel failed throws instead of mailing, and a degraded run is skipped when the subscription asks for complete reports only.",
    recipientLabel: "Subscription recipients",
    recipient:
      "The normalized recipient list stored on the subscription. One email per address, all carrying the same rendered snapshot.",
    senderLabel: "Default sender",
    sender:
      "The configured default sender. This call site sets no `from`, `fromName`, `replyTo`, or `appSender`.",
    // The real renderer runs every panel query and rasterizes charts, so it
    // cannot back a preview that must stay offline. This shows the frame a
    // recipient sees; the panel body is whatever that run produced.
    preview: () => ({
      subject: "Daily dashboard: Growth overview — 3/4/2025",
      ...renderEmail({
        preheader: "Your daily Growth overview report is ready.",
        heading: "Daily dashboard: Growth overview",
        paragraphs: [
          `This report renders each panel of ${emailStrong("Growth overview")} as of the run time, with charts drawn server-side and attached inline.`,
          "Panels that could not be queried are called out in place rather than dropped, so a partial report never reads as a complete one.",
        ],
        cta: {
          label: "Open dashboard",
          url: "https://example.com/dashboards/dash_sample",
        },
        footer:
          "You received this because you are on the recipient list for this dashboard report.",
      }),
    }),
  });
}
