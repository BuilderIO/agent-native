import { getDb, schema } from "./db/index.js";
import { seedJourneys } from "./seed-journeys.js";

const FIRST = ["Avery","Jordan","Riley","Morgan","Casey","Taylor","Quinn","Rowan","Sage","Emery","Dakota","Skyler","Harper","Reese","Finley","Parker","Blake","Cameron","Drew","Elliot"];
const LAST = ["Nguyen","Patel","Garcia","Kim","Okafor","Rossi","Haddad","Lindqvist","Silva","Novak","Brennan","Tanaka","Moreau","Castillo","Fischer","Adeyemi","Ivanov","Larsen","Mehta","Walsh"];
const TITLES = ["VP Marketing","Demand Gen Manager","Head of Growth","Marketing Ops Lead","CMO","Product Marketing Manager","Director of Lifecycle","RevOps Manager","Founder","Content Lead"];
const COUNTRIES: [string, string][] = [["United States","CA"],["United States","NY"],["United States","TX"],["United Kingdom","ENG"],["Germany","BE"],["Canada","ON"],["Australia","NSW"],["France","IDF"]];
const STAGES = ["lead","marketing qualified","sales qualified","opportunity","customer"];
const SOURCES = ["Webinar","Website form","Paid social","Referral","Product signup","Event"];
const COMPANIES: [string, string, string, string][] = [
  ["Northwind Labs","northwindlabs.example","Software","Growth"],["Brightpath Health","brightpath.example","Healthcare","Enterprise"],
  ["Cobalt Freight","cobaltfreight.example","Logistics","Team"],["Lumen Retail","lumenretail.example","Retail","Growth"],
  ["Orchard Finance","orchardfinance.example","Financial services","Enterprise"],["Pinecrest Media","pinecrest.example","Media","Starter"],
  ["Sundial Energy","sundialenergy.example","Energy","Team"],["Harbor Analytics","harboranalytics.example","Software","Enterprise"],
  ["Kestrel Robotics","kestrelrobotics.example","Manufacturing","Growth"],["Tidewater Travel","tidewater.example","Travel","Starter"],
  ["Vantage Learning","vantagelearning.example","Education","Team"],["Willow & Oak","willowoak.example","Consumer goods","Starter"],
];
const OWNERS = ["Priya Shah","Marcus Lee","Elena Petrova","Sam Ortiz"];

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]!;

export async function seedWorkspace() {
  const db = getDb();
  const ts = { createdAt: iso(60), updatedAt: iso(2) };

  const accounts = COMPANIES.map(([name, domain, industry, plan], i) => ({
    id: `acct_${i + 1}`, name, domain, industry, plan, owner: pick(OWNERS, i),
    employees: [45, 1200, 310, 640, 5200, 28, 410, 2300, 780, 95, 360, 60][i]!,
    renewalDate: iso(-30 - i * 17).slice(0, 10),
    score: [82, 91, 55, 68, 96, 24, 47, 88, 61, 33, 52, 19][i]!,
    signals: [["Pricing page visits up 3x", "Teammates invited"], ["Executive attended webinar"], ["Support ticket open"], ["Renewal in 60 days"]].slice(0, 1 + (i % 3)).flat(),
    ...ts,
  }));
  await db.insert(schema.accounts).values(accounts);

  const contacts = Array.from({ length: 72 }, (_, i) => {
    const first = pick(FIRST, i * 3), last = pick(LAST, i * 7 + 1);
    const acct = accounts[i % accounts.length]!;
    const [country, state] = pick(COUNTRIES, i * 5);
    return {
      id: `c_${i + 1}`, name: `${first} ${last}`,
      email: `${first}.${last}${i}@${acct.domain}`.toLowerCase(),
      title: pick(TITLES, i * 3 + 2), accountId: acct.id, country, state,
      lifecycleStage: pick(STAGES, i * 2 + (i % 3)), source: pick(SOURCES, i * 5),
      subscribed: i % 17 === 0 ? 0 : 1, lastActive: iso(i % 29),
      activity: {
        email_opened: (i * 7) % 9, email_clicked: (i * 3) % 5, form_submitted: i % 4 === 0 ? 1 : 0,
        page_viewed: (i * 11) % 14, pricing_viewed: i % 5 === 0 ? 2 : 0,
        workspace_created: i % 6 === 0 ? 1 : 0, invited_teammate: i % 8 === 0 ? 2 : 0, qualified_for_journey: i % 3 === 0 ? 1 : 0,
      },
      lists: i % 4 === 0 ? ["aud_newsletter"] : [],
      createdAt: iso(90 - (i % 80)), updatedAt: iso(i % 29),
    };
  });
  await db.insert(schema.contacts).values(contacts);

  const group = (conditions: object[], logic = "and") => ({ logic: "and", groups: [{ logic, conditions }] });
  await db.insert(schema.audiences).values([
    { id: "aud_mql", name: "Marketing qualified leads", kind: "dynamic", filter: group([{ type: "property", field: "lifecycleStage", op: "equal to", value: "marketing qualified" }]), memberIds: [], ...ts },
    { id: "aud_pricing", name: "Pricing page visitors, last 30 days", kind: "dynamic", filter: group([{ type: "activity", field: "pricing_viewed", op: "at least", count: 1, days: 30 }]), memberIds: [], ...ts },
    { id: "aud_enterprise", name: "Enterprise accounts", kind: "segment", filter: group([{ type: "property", field: "account.plan", op: "equal to", value: "Enterprise" }]), memberIds: [], ...ts },
    { id: "aud_trial", name: "Product signups without a teammate", kind: "dynamic", filter: group([{ type: "activity", field: "workspace_created", op: "at least", count: 1 }, { type: "activity", field: "invited_teammate", op: "never" }]), memberIds: [], ...ts },
    { id: "aud_newsletter", name: "Newsletter subscribers", kind: "static", filter: {}, memberIds: contacts.filter((_, i) => i % 4 === 0).map((c) => c.id), ...ts },
    { id: "aud_webinar", name: "Webinar attendees", kind: "static", filter: {}, memberIds: contacts.filter((_, i) => i % 5 === 1).map((c) => c.id), ...ts },
  ]);

  const body = (title: string, copy: string, cta: string) => JSON.stringify([
    { type: "heading", text: title }, { type: "text", text: copy }, { type: "button", text: cta, url: "https://example.com/start" },
    { type: "text", text: "Questions? Just reply to this email." },
  ]);
  const mk = (id: string, name: string, subject: string, pre: string, title: string, copy: string, cta: string, kind = "marketing", status = "published") => ({
    id, name, subject, preheader: pre, fromName: "The Journeys Team", fromEmail: "hello@mail.example.com", replyTo: "support@example.com",
    body: body(title, copy, cta), kind, status, trackOpens: 1, trackClicks: 1, ...ts,
  });
  await db.insert(schema.emails).values([
    mk("em_welcome", "Welcome to Journeys", "Welcome, {{first_name}}", "Here is how to get set up in ten minutes", "Welcome aboard", "We are glad you are here. Start by connecting your data and building your first journey.", "Open your workspace"),
    mk("em_tips", "Getting started tips", "Three things to try first", "Quick wins for your first week", "Make your first week count", "Connect a source, build an audience, and publish a simple two-step journey.", "See the guide"),
    mk("em_nudge", "Invite your team", "{{first_name}}, bring your team along", "Journeys works better together", "Invite a teammate", "Teams that invite a colleague in week one publish journeys twice as fast.", "Invite teammates"),
    mk("em_webinar_thanks", "Webinar thank you", "Thanks for joining us", "Recording and slides inside", "Thanks for attending", "Here are the recording, the slides, and the templates we walked through.", "Watch the recording"),
    mk("em_webinar_missed", "Webinar sorry we missed you", "Sorry we missed you", "Catch up on demand", "You were missed", "No worries. The full session is available on demand.", "Watch on demand"),
    mk("em_renewal_90", "Renewal reminder, 90 days", "Your plan renews soon", "A quick review before renewal", "Planning your renewal", "Your plan renews in 90 days. Let us review what you achieved this year.", "Book a review"),
    mk("em_winback", "Re-engagement", "Still interested, {{first_name}}?", "A lot has changed since you last visited", "We have been busy", "New templates, faster journeys, and a simpler canvas.", "See what is new"),
    mk("em_alert", "Internal: high intent account", "High intent: {{account_name}}", "Sales follow-up requested", "Account is showing intent", "{{account_name}} viewed pricing and invited teammates in the last 7 days.", "Open account", "internal"),
    mk("em_receipt", "Transactional: password reset", "Reset your password", "This link expires in one hour", "Reset your password", "Use the button below to choose a new password.", "Reset password", "transactional"),
    mk("em_draft_launch", "Product launch announcement", "Introducing the new canvas", "Faster, clearer, calmer", "Meet the new canvas", "Everything you asked for, in one place.", "Take the tour", "marketing", "draft"),
  ]);

  await db.insert(schema.tokens).values([
    { id: "tok_first", name: "first_name", kind: "text", source: "name", fallback: "there", rules: [], ...ts },
    { id: "tok_account", name: "account_name", kind: "text", source: "account.name", fallback: "your company", rules: [], ...ts },
    { id: "tok_tier", name: "plan_tier", kind: "text", source: "account.plan", fallback: "Starter", rules: [{ when: "Enterprise", then: "Priority support" }, { when: "Growth", then: "Standard support" }], ...ts },
    { id: "tok_region", name: "sales_region", kind: "text", source: "country", fallback: "Rest of world", rules: [{ when: "United States", then: "AMER" }, { when: "Canada", then: "AMER" }, { when: "United Kingdom", then: "EMEA" }, { when: "Germany", then: "EMEA" }, { when: "France", then: "EMEA" }, { when: "Australia", then: "APAC" }], ...ts },
  ]);

  await db.insert(schema.connections).values([
    { id: "conn_sf", provider: "Salesforce", category: "CRM", status: "connected", detail: "Production org, syncing every 15 minutes", lastSyncAt: iso(0.01), config: {} },
    { id: "conn_seg", provider: "Segment", category: "Event source", status: "connected", detail: "Receiving track and identify calls", lastSyncAt: iso(0.002), config: {} },
    { id: "conn_amp", provider: "Amplitude", category: "Event source", status: "disconnected", detail: "", lastSyncAt: null, config: {} },
    { id: "conn_bq", provider: "BigQuery", category: "Data warehouse", status: "connected", detail: "Importing the customers_enriched table nightly", lastSyncAt: iso(0.4), config: {} },
    { id: "conn_snow", provider: "Snowflake", category: "Data warehouse", status: "disconnected", detail: "", lastSyncAt: null, config: {} },
    { id: "conn_web", provider: "Web tracking", category: "Website", status: "connected", detail: "Tracking snippet verified on 2 domains", lastSyncAt: iso(0.001), config: {} },
    { id: "conn_forms", provider: "Forms", category: "Website", status: "connected", detail: "4 hosted forms", lastSyncAt: iso(0.05), config: {} },
    { id: "conn_zap", provider: "Zapier", category: "Inbound webhook", status: "disconnected", detail: "", lastSyncAt: null, config: {} },
    { id: "conn_out", provider: "Outbound webhooks", category: "Outbound webhook", status: "connected", detail: "2 endpoints", lastSyncAt: iso(0.2), config: {} },
  ]);

  await db.insert(schema.settings).values([
    { key: "email", value: { sendingDomain: "mail.example.com", domainStatus: "verified", dkim: "verified", spf: "verified", dmarc: "needs attention", defaultFromName: "The Journeys Team", defaultFromEmail: "hello@mail.example.com", defaultReplyTo: "support@example.com", maxEmailsPerDay: 3, maxEmailsPerWeek: 8, footerAddress: "100 Market Street, San Francisco, CA", unsubscribeUrl: "https://mail.example.com/unsubscribe" } },
    { key: "utm", value: { source: "journeys", medium: "email", campaign: "{{journey_name}}", content: "{{email_name}}", term: "", appendToAllLinks: true } },
    { key: "mmc", value: { plan: 25000 } },
  ]);

  await db.insert(schema.users).values([
    { id: "u_1", name: "Priya Shah", email: "priya@example.com", role: "admin", status: "active", ...ts },
    { id: "u_2", name: "Marcus Lee", email: "marcus@example.com", role: "editor", status: "active", ...ts },
    { id: "u_3", name: "Elena Petrova", email: "elena@example.com", role: "editor", status: "active", ...ts },
    { id: "u_4", name: "Sam Ortiz", email: "sam@example.com", role: "viewer", status: "invited", ...ts },
  ]);

  await seedJourneys(contacts.map((c) => c.id));
}
