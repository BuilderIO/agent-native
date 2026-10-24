import type { DriveContext } from "../scripts/drive.ts";

const VIEWS = [
  "Inbox",
  "Unread",
  "Starred",
  "Snoozed",
  "Sent",
  "Scheduled",
  "Drafts",
  "Archive",
  "Trash",
];

// Needs local mailbox data (run mail-compose-draft first) so views render past the Connect gate.
export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  await ctx.open("/inbox");
  const tabs = page.getByRole("banner").getByRole("navigation");
  for (const tab of ["All", "Important", "Other"]) {
    await tabs
      .getByRole("link", { name: tab, exact: true })
      .waitFor({ timeout: 15_000 });
  }

  await page.getByRole("button", { name: "Toggle menu" }).click();
  for (const view of VIEWS) {
    await page
      .getByRole("link", { name: view, exact: true })
      .waitFor({ timeout: 10_000 });
  }
  // The Draft queue link's name carries its pending count, e.g. "Draft queue 1".
  await page.getByRole("link", { name: /^Draft queue/ }).waitFor();
  await ctx.shot("nav-drawer");
  await page.getByRole("link", { name: "Sent", exact: true }).click();
  await page.waitForURL(/\/sent(\?|$)/, { timeout: 15_000 });
  await ctx.note(`drawer Sent -> ${page.url()}`);

  await ctx.open("/inbox");
  await page.getByRole("button", { name: "Configure tabs" }).click();
  await page
    .getByRole("dialog")
    .getByRole("switch", { name: "All tab" })
    .waitFor({ timeout: 10_000 });
  await ctx.shot("configure-tabs");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Notifications" }).click();
  await page
    .getByText("No app notifications yet.")
    .waitFor({ timeout: 10_000 });
  await ctx.shot("notifications-empty");
  await page.keyboard.press("Escape");
}
