/**
 * DEV TOOL: Generates fake test emails and appends them to data/emails.json.
 * These are NOT real emails — they are synthetic data for testing the UI without a Google account.
 * Usage: pnpm script seed-emails --count=10
 */

import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { parseArgs, output, fatal } from "./helpers.js";

const EMAILS_FILE = path.join(process.cwd(), "data", "emails.json");

const SENDERS = [
  { name: "Sarah Chen", email: "sarah.chen@acme.com" },
  { name: "Alex Rivera", email: "alex@designco.io" },
  { name: "Jordan Kim", email: "jordan@startup.dev" },
  { name: "Maya Patel", email: "maya.patel@company.com" },
  { name: "Chris Wong", email: "chris@opensource.dev" },
  { name: "GitHub", email: "noreply@github.com" },
  { name: "Linear", email: "notifications@linear.app" },
  { name: "Vercel", email: "team@vercel.com" },
  { name: "Stripe", email: "billing@stripe.com" },
  { name: "Lena Fischer", email: "lena@vc.fund" },
];

const SUBJECTS = [
  "Weekly sync notes",
  "Re: Project update",
  "Quick question about the API",
  "Action required: Review PR",
  "Deploy succeeded ✓",
  "New issue assigned to you",
  "Invoice ready for review",
  "Design review Thursday",
  "Sprint retrospective notes",
  "Feature request from customer",
  "Welcome to the beta!",
  "Following up from our conversation",
  "Onboarding flow — final feedback",
  "Q3 roadmap review",
  "Team offsite dates confirmed",
];

const BODIES = [
  "Just wanted to follow up on our conversation. Are you available for a quick call this week?\n\nBest,",
  "The new feature is ready for review. I've attached the Figma mockups and a short Loom.\n\nThanks,",
  "Heads up — the deploy finished successfully. All checks passed and the service is healthy.\n\nRegards,",
  "Can you take a look at this PR when you get a chance? It's blocking the release.\n\nThanks,",
  "The sprint is wrapping up. Please update your tickets before the retro tomorrow.\n\nCheers,",
  "I've been thinking about what we discussed — I think the right move is to decouple the auth layer entirely. Happy to hop on a call.\n\nBest,",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysBack = 14): string {
  const offset = Math.random() * daysBack * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - offset).toISOString();
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const count = args.count ? parseInt(args.count, 10) : 5;

  if (isNaN(count) || count < 1) fatal("--count must be a positive integer");

  let emails: unknown[] = [];
  try {
    emails = JSON.parse(fs.readFileSync(EMAILS_FILE, "utf-8"));
  } catch {
    emails = [];
  }

  const newEmails = Array.from({ length: count }, () => {
    const sender = randomFrom(SENDERS);
    const subject = randomFrom(SUBJECTS);
    const bodyText = randomFrom(BODIES);
    const snippet = bodyText.slice(0, 100).replace(/\n/g, " ");

    return {
      id: `msg-${nanoid(8)}`,
      threadId: `thread-${nanoid(8)}`,
      from: sender,
      to: [{ name: "You", email: "me@example.com" }],
      subject,
      snippet,
      body: `${bodyText}\n${sender.name}`,
      date: randomDate(14),
      isRead: Math.random() > 0.45,
      isStarred: Math.random() > 0.88,
      isArchived: false,
      isTrashed: false,
      labelIds: ["inbox"],
    };
  });

  emails.push(...newEmails);
  fs.writeFileSync(EMAILS_FILE, JSON.stringify(emails, null, 2));

  output({
    added: count,
    total: (emails as unknown[]).length,
    message: `Added ${count} demo email(s) to data/emails.json`,
  });
}
