import type { JourneyEdge, JourneyNode } from "../shared/types.js";
import { getDb, schema } from "./db/index.js";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

const N = (id: string, type: string, x: number, y: number, label: string, config: Record<string, unknown> = {}): JourneyNode => ({ id, type, x, y, label, config });
const E = (source: string, target: string, handle?: string): JourneyEdge => ({ id: `${source}-${target}${handle ? `-${handle}` : ""}`, source, target, ...(handle ? { handle } : {}) });
const trigger = (audienceLabel: string) => N("start", "trigger", 320, 40, audienceLabel, {});

interface Def {
  id: string; name: string; status: string; kind: string; audienceId: string | null; goal: string;
  nodes: JourneyNode[]; edges: JourneyEdge[]; volume: number; emails: string[];
}

const defs: Def[] = [
  {
    id: "jr_welcome", name: "New signup welcome series", status: "active", kind: "audience", audienceId: "aud_trial",
    goal: "Get new signups to invite a teammate within 7 days", volume: 420, emails: ["em_welcome", "em_tips", "em_nudge"],
    nodes: [
      trigger("Product signups without a teammate"),
      N("n1", "send_email", 320, 170, "Welcome to Journeys", { emailId: "em_welcome" }),
      N("n2", "delay", 320, 300, "Wait 2 days", { mode: "interval", amount: 2, unit: "days" }),
      N("n3", "branch_filter", 320, 430, "Opened the welcome email?", { filter: { logic: "and", groups: [{ logic: "and", conditions: [{ type: "activity", field: "email_opened", op: "at least", count: 1, days: 2 }] }] } }),
      N("n4", "send_email", 120, 590, "Getting started tips", { emailId: "em_tips" }),
      N("n5", "update_value", 520, 590, "Set lifecycle stage", { field: "lifecycleStage", value: "lead" }),
      N("n6", "send_email", 120, 730, "Invite your team", { emailId: "em_nudge" }),
      N("n7", "add_to_list", 520, 730, "Add to newsletter", { listId: "aud_newsletter" }),
    ],
    edges: [E("start", "n1"), E("n1", "n2"), E("n2", "n3"), E("n3", "n4", "yes"), E("n3", "n5", "no"), E("n4", "n6"), E("n5", "n7")],
  },
  {
    id: "jr_webinar", name: "Webinar follow-up", status: "active", kind: "audience", audienceId: "aud_webinar",
    goal: "Move webinar attendees to a sales conversation", volume: 210, emails: ["em_webinar_thanks", "em_webinar_missed"],
    nodes: [
      trigger("Webinar attendees"),
      N("n1", "send_email", 320, 170, "Webinar thank you", { emailId: "em_webinar_thanks" }),
      N("n2", "delay", 320, 300, "Wait until 9:00 AM next Tuesday", { mode: "specific", timeOfDay: "09:00", days: ["tue"], useRecipientTimezone: true }),
      N("n3", "branch_value", 320, 430, "Branch by lifecycle stage", { field: "lifecycleStage", values: ["lead", "opportunity"] }),
      N("n4", "internal_alert", 120, 590, "Alert sales", { emailId: "em_alert", recipient: "sales@example.com" }),
      N("n5", "add_salesforce_campaign", 520, 590, "Add to Q4 webinar campaign", { campaign: "Q4 Webinar Series", memberStatus: "Responded" }),
    ],
    edges: [E("start", "n1"), E("n1", "n2"), E("n2", "n3"), E("n3", "n4", "opportunity"), E("n3", "n5", "lead")],
  },
  {
    id: "jr_hot", name: "High-intent account alert", status: "active", kind: "trigger", audienceId: null,
    goal: "Notify sales when an enterprise account shows buying intent", volume: 64, emails: ["em_alert"],
    nodes: [
      N("start", "trigger", 320, 40, "Performed: viewed the pricing page", {}),
      N("n1", "branch_filter", 320, 170, "Enterprise account?", { filter: { logic: "and", groups: [{ logic: "and", conditions: [{ type: "property", field: "account.plan", op: "equal to", value: "Enterprise" }] }] } }),
      N("n2", "internal_alert", 160, 330, "Alert account owner", { emailId: "em_alert", recipient: "sales@example.com" }),
      N("n3", "outbound_webhook", 160, 460, "Post to sales channel", { url: "https://hooks.example.com/sales", method: "POST", payload: '{"text":"{{account_name}} is showing intent"}' }),
      N("n4", "add_to_list", 500, 330, "Add to nurture list", { listId: "aud_newsletter" }),
    ],
    edges: [E("start", "n1"), E("n1", "n2", "yes"), E("n2", "n3"), E("n1", "n4", "no")],
  },
  {
    id: "jr_renewal", name: "Renewal reminders", status: "paused", kind: "audience", audienceId: "aud_enterprise",
    goal: "Book a review call before each renewal", volume: 98, emails: ["em_renewal_90"],
    nodes: [
      trigger("Enterprise accounts"),
      N("n1", "send_email", 320, 170, "Renewal reminder, 90 days", { emailId: "em_renewal_90" }),
      N("n2", "wait_salesforce_sync", 320, 300, "Wait for Salesforce sync", {}),
      N("n3", "add_salesforce_campaign", 320, 430, "Add to renewal campaign", { campaign: "FY Renewals", memberStatus: "Sent" }),
    ],
    edges: [E("start", "n1"), E("n1", "n2"), E("n2", "n3")],
  },
  {
    id: "jr_winback", name: "Re-engagement campaign", status: "draft", kind: "audience", audienceId: "aud_mql",
    goal: "Reactivate marketing qualified leads that went quiet", volume: 0, emails: ["em_winback"],
    nodes: [
      trigger("Marketing qualified leads"),
      N("n1", "send_email", 320, 170, "Still interested?", { emailId: "em_winback" }),
      N("n2", "delay", 320, 300, "Wait 5 days", { mode: "interval", amount: 5, unit: "days" }),
      N("n3", "branch_filter", 320, 430, "Clicked the email?", { filter: { logic: "and", groups: [{ logic: "and", conditions: [{ type: "activity", field: "email_clicked", op: "at least", count: 1, days: 5 }] }] } }),
    ],
    edges: [E("start", "n1"), E("n1", "n2"), E("n2", "n3")],
  },
  {
    id: "jr_q3", name: "Q3 launch announcement", status: "finished", kind: "audience", audienceId: "aud_newsletter",
    goal: "Announce the new canvas to subscribers", volume: 540, emails: ["em_draft_launch"],
    nodes: [trigger("Newsletter subscribers"), N("n1", "send_email", 320, 170, "Introducing the new canvas", { emailId: "em_draft_launch" })],
    edges: [E("start", "n1")],
  },
];

export async function seedJourneys(contactIds: string[]) {
  const db = getDb();
  const sendRows: (typeof schema.sends.$inferInsert)[] = [];
  const memberRows: (typeof schema.members.$inferInsert)[] = [];

  for (const [index, d] of defs.entries()) {
    const nodeIds = d.nodes.filter((n) => n.type !== "trigger").map((n) => n.id);
    await db.insert(schema.journeys).values({
      id: d.id, name: d.name, status: d.status, kind: d.kind, audienceId: d.audienceId, goal: d.goal,
      nodes: d.nodes, edges: d.edges,
      settings: { reentry: d.kind === "trigger" ? "after-exit" : "never", exitCriteria: "", communicationLimits: "apply", timezone: "America/Los_Angeles", conversionId: "cv_invite" },
      report: {
        topLinks: [{ url: "https://example.com/start", clicks: Math.round(d.volume * 0.31) }, { url: "https://example.com/guide", clicks: Math.round(d.volume * 0.18) }, { url: "https://example.com/pricing", clicks: Math.round(d.volume * 0.07) }],
        clients: [{ name: "Apple Mail", share: 0.46 }, { name: "Gmail", share: 0.31 }, { name: "Outlook", share: 0.17 }, { name: "Other", share: 0.06 }],
      },
      entered: d.volume, exited: Math.round(d.volume * (d.status === "finished" ? 1 : 0.62)),
      createdAt: iso(50 - index * 3), updatedAt: iso(index),
    });

    if (d.volume === 0) continue;
    for (const emailId of d.emails) {
      for (let k = 0; k < 28; k++) {
        const base = Math.round((d.volume / 28) * (0.6 + ((k * 7 + index) % 9) / 10));
        sendRows.push({
          id: `s_${d.id}_${emailId}_${k}`, journeyId: d.id, emailId, day: day(k),
          sent: base, delivered: Math.round(base * 0.985), opened: Math.round(base * (0.42 + (index % 3) * 0.05)),
          clicked: Math.round(base * (0.11 + (k % 4) * 0.01)), bounced: Math.round(base * 0.015), unsubscribed: Math.round(base * 0.004),
        });
      }
    }
    for (let m = 0; m < 18; m++) {
      const exited = m % 3 !== 0 && d.status !== "draft";
      memberRows.push({
        id: `m_${d.id}_${m}`, journeyId: d.id, contactId: contactIds[(m * 4 + index * 5) % contactIds.length]!,
        status: exited ? (m % 6 === 1 ? "exited" : "completed") : "active",
        currentNodeId: exited ? null : nodeIds[m % nodeIds.length] ?? null,
        enteredAt: iso(20 - m), exitedAt: exited ? iso(18 - m) : null,
      });
    }
  }
  await db.insert(schema.sends).values(sendRows);
  await db.insert(schema.members).values(memberRows);

  const ts = { createdAt: iso(40), updatedAt: iso(3) };
  await db.insert(schema.conversions).values([
    { id: "cv_invite", name: "Invited a teammate", eventType: "invited_teammate", windowDays: 7, journeyId: "jr_welcome", count: 137, ...ts },
    { id: "cv_demo", name: "Booked a demo", eventType: "form_submitted", windowDays: 14, journeyId: "jr_webinar", count: 41, ...ts },
    { id: "cv_pricing", name: "Viewed pricing", eventType: "pricing_viewed", windowDays: 30, journeyId: null, count: 212, ...ts },
  ]);
}
