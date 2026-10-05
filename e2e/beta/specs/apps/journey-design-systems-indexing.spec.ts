import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { authenticatableSites, originFor } from "../../lib/fleet";
import { callAction, expectJsonOk } from "../../lib/journey-browser";
import {
  findStuckDesignSystems,
  type DesignSystemRow,
} from "../../lib/journey-checks";

/**
 * Design systems that never finish indexing.
 *
 * "Every design system is indexing" was reported on 9/1, 9/14 (twice), 9/15,
 * 9/17, 9/18, 9/21 and 9/22 (Slack #product-agent-native-feedback). On 9/18 a
 * fix made indexing "retry until the list reaches a usable state"; it was
 * still stuck on 9/21 and 9/22, and on 9/30 a deck still could not be started
 * without one. A Builder-backed design system is usable once its document
 * count is above zero; one created long ago that still is not is stuck.
 *
 * Read-only: lists what the e2e identity can see and creates nothing. If the
 * identity sees no Builder-backed design system there is nothing to measure,
 * and the annotation says so.
 */

skipUnlessAuthed();

const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;
const DESIGN_SYSTEM_APPS = ["design", "slides"];
const sites = authenticatableSites().filter((site) =>
  DESIGN_SYSTEM_APPS.includes(site.id),
);

test.describe.configure({ mode: "parallel" });

for (const site of sites) {
  test(`[journey] [design-systems] ${site.id} has no design system stuck indexing for more than 24 hours`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();

      const listed = expectJsonOk<{ designSystems?: unknown }>(
        await callAction(page.request, origin, "list-design-systems", {
          timeoutMs: 120_000,
        }),
        `${site.host} list-design-systems`,
      );
      if (!Array.isArray(listed.designSystems)) {
        throw new Error(
          `${site.host} list-design-systems returned no designSystems array: ${JSON.stringify(listed).slice(0, 300)}`,
        );
      }
      const rows = listed.designSystems as DesignSystemRow[];
      const withoutId = rows.filter((row) => typeof row?.id !== "string");
      expect(
        withoutId.length,
        `${site.host} list-design-systems returned ${withoutId.length} row(s) with no string id`,
      ).toBe(0);

      const report = findStuckDesignSystems(rows, Date.now(), STUCK_AFTER_MS);
      test.info().annotations.push({
        type: "design-systems",
        description: `${site.id}: visible=${report.total} builderBacked=${report.builderBacked} indexed=${report.indexed} stuck=${report.stuck.length} unreadable=${report.unreadable.length}`,
      });

      expect(
        report.unreadable,
        `${site.host} has design system rows whose indexing state cannot be read, so they cannot be called healthy:\n${report.unreadable.map((entry) => `${entry.id}: ${entry.reason}`).join("\n")}`,
      ).toEqual([]);

      // Design can say what Builder reports for each stuck system right now.
      const live: string[] = [];
      if (site.id === "design") {
        for (const entry of report.stuck.slice(0, 5)) {
          const status = await callAction(
            page.request,
            origin,
            "get-design-system-index-status",
            { params: { id: entry.id }, timeoutMs: 60_000 },
          );
          live.push(
            `${entry.id}: get-design-system-index-status -> HTTP ${status.status} ${status.text.slice(0, 200)}`,
          );
        }
      }

      expect(
        report.stuck.map((entry) => entry.id),
        `${site.host} has ${report.stuck.length} Builder-backed design system(s) not indexed more than 24 hours after creation (visible ${report.total}, Builder-backed ${report.builderBacked}, indexed ${report.indexed}):\n${report.stuck
          .map(
            (entry) =>
              `- ${entry.id} "${entry.title}" owner=${entry.owner} created=${entry.createdAt} (${entry.ageHours}h ago) updated=${entry.updatedAt} builderStatus=${entry.builderStatus} docCount=${entry.docCount}`,
          )
          .join("\n")}\n${live.join("\n")}`,
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
