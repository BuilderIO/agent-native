import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";
import { callAction, expectJsonOk } from "../../lib/journey-browser";
import {
  pickOpenableApps,
  type WorkspaceAppLike,
} from "../../lib/journey-checks";
import { openWorkspaceApp } from "../../lib/journey-dispatch";

/**
 * Dispatch workspace apps: every listed app must open.
 *
 * Custom workspace apps returned 404 on 9/3, 9/8, 9/14, 9/15, 9/21 and 9/22,
 * "5 reports, org-wide" on 9/23 (Slack #product-agent-native-feedback). The
 * 9/15 fix (#5115) did not end it: people were silently redirected to the
 * beta lane, where the app list differs, and the reports returned on 9/28 to
 * 9/30 as preview sign-in failures. The existing journey opens only the first
 * listed app. This opens each one (up to 8), through its Dispatch route, and
 * checks the page, the embedded app, and which lane both ended up on.
 *
 * Read-only: nothing is created, archived, or changed.
 */

skipUnlessAuthed();

const MAX_APPS = 8;
const PER_APP_BUDGET_MS = 150_000;

test.describe.configure({ mode: "parallel" });

test("[journey] [dispatch-apps] dispatch opens each listed workspace app without a 404 or a lane change", async ({
  browser,
}) => {
  const site = siteById("dispatch");
  test.skip(
    !selectedSites().some((entry) => entry.id === site.id),
    "dispatch is not in this run's selection",
  );
  const origin = originFor(site);
  const context = await signedInContext(browser, site, { seedModel: false });
  try {
    await assertSignedInOnBeta(context, site);
    const page = await context.newPage();

    const listed = expectJsonOk<unknown>(
      await callAction(page.request, origin, "list-workspace-apps", {
        params: { includeAgentCards: "false" },
        timeoutMs: 120_000,
      }),
      `${site.host} list-workspace-apps`,
    );
    if (!Array.isArray(listed)) {
      throw new Error(
        `${site.host} list-workspace-apps did not return an array: ${JSON.stringify(listed).slice(0, 300)}`,
      );
    }
    const apps = listed as WorkspaceAppLike[];
    const picked = pickOpenableApps(apps, MAX_APPS);
    test.info().annotations.push({
      type: "dispatch-apps",
      description: `listed=${apps.length} openable=${picked.length}: ${picked.map((app) => app.id).join(", ")}`,
    });
    test.skip(
      picked.length === 0,
      `this account lists ${apps.length} workspace app(s) and none is ready, visible and not Dispatch itself`,
    );
    test.setTimeout(60_000 + picked.length * PER_APP_BUDGET_MS);

    const failures: string[] = [];
    for (const app of picked) {
      const outcome = await openWorkspaceApp(page, origin, app);
      test.info().annotations.push({
        type: "dispatch-app",
        description: outcome.summary,
      });
      failures.push(...outcome.problems);
    }
    expect(
      failures,
      `${site.host}: ${failures.length} problem(s) opening ${picked.length} listed workspace app(s):\n- ${failures.join("\n- ")}`,
    ).toEqual([]);
  } finally {
    await context.close();
  }
});
