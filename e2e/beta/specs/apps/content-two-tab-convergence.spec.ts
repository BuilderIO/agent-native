import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  AgentClient,
  createPage,
  EDITOR_BODY,
  integrityFailures,
  Markers,
  observeIntegrity,
  TabSet,
  typeAtParagraphEnd,
  writeScenarioRecord,
  type ScenarioRecord,
} from "../../../../templates/content/e2e/helpers";
import {
  assertSignedInOnBeta,
  runMarker,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { purgeContentPage } from "../../lib/content-pages";
import { originFor, selectedSites, siteById } from "../../lib/fleet";

skipUnlessAuthed();

// These count how often two tabs disagree on the deployed build. A retry would
// hide exactly the intermittent loss they exist to catch.
test.describe.configure({ retries: 0 });

const selected = new Set(selectedSites().map((site) => site.id));

// React Router names the manifest after a hash of the build, so it changes
// with every deploy.
async function deployedBuild(page: Page, id: string): Promise<string> {
  const shell = await (await page.request.get(`/page/${id}`)).text();
  const build = /\/assets\/manifest-([a-z0-9]+)\.js/i.exec(shell)?.[1];
  if (!build) throw new Error("The Content page shell names no build manifest");
  return build;
}

interface BetaScenario {
  tabs: TabSet;
  id: string;
  markers: Markers;
  reader: Page;
  notes: Record<string, unknown>;
}

async function runOnBeta(
  name: string,
  browser: Browser,
  testInfo: TestInfo,
  body: (scenario: BetaScenario) => Promise<void>,
) {
  test.skip(!selected.has("content"), "content is not in this run's selection");
  const site = siteById("content");
  const origin = originFor(site);
  const context = await signedInContext(browser, site, {
    seedModel: false,
    baseURL: origin,
  });
  const reader = await context.newPage();
  const title = `${runMarker(`content two-tab ${name}`)} ${crypto.randomUUID()}`;
  let id: string | undefined;
  const started = Date.now();
  try {
    await assertSignedInOnBeta(context, site);
    // Beta answers the realtime stream itself, so nothing is emulated here.
    const tabs = await TabSet.create(context, { refuseRealtime: false });
    id = await createPage(reader, title, EDITOR_BODY);
    const scenario: BetaScenario = {
      tabs,
      id,
      markers: new Markers(),
      reader,
      notes: { buildAtStart: await deployedBuild(reader, id) },
    };
    await body(scenario);
    const working = [...tabs.tabs.values()];
    const integrity = await observeIntegrity(
      tabs,
      reader,
      id,
      scenario.markers.all,
    );
    scenario.notes.buildAtEnd = await deployedBuild(reader, id);
    scenario.notes.realtime = working.map((tab) => ({
      tab: tab.label,
      refused: tab.realtimeRefusals,
      streamed: tab.realtimeStreams,
    }));
    const record: ScenarioRecord = {
      scenario: `beta-${name}`,
      tags: testInfo.tags,
      notes: scenario.notes,
      build: String(scenario.notes.buildAtStart),
      authoredEdits: scenario.markers.all.length,
      markers: scenario.markers.all.length,
      durationMs: Date.now() - started,
      integrity,
      tabs: [...tabs.tabs.values(), tabs.detached],
    };
    writeScenarioRecord(testInfo, record);
    await testInfo.attach("convergence", {
      body: JSON.stringify(record, null, 2),
      contentType: "application/json",
    });
    // A deploy mid-run reloads the tabs. Loss there is still loss, but it is
    // the known deploy-reload path, so the message names it.
    const deployed =
      scenario.notes.buildAtStart !== scenario.notes.buildAtEnd
        ? ` while beta deployed ${scenario.notes.buildAtStart} -> ${scenario.notes.buildAtEnd} (deploy-reload loss path)`
        : "";
    expect(
      integrityFailures(record),
      `lost or duplicated text${deployed}`,
    ).toEqual([]);
  } finally {
    try {
      if (id) await purgeContentPage(reader, origin, id, title);
    } finally {
      await context.close();
    }
  }
}

test.describe("[content-convergence] two tabs on one beta page", () => {
  test("alternating edits in different paragraphs keep both tabs' text", async ({
    browser,
  }, testInfo) => {
    await runOnBeta("alternating", browser, testInfo, async (s) => {
      const first = await s.tabs.open("A", s.id);
      const second = await s.tabs.open("B", s.id);
      for (let cycle = 1; cycle <= 4; cycle++) {
        for (const [tab, anchor, label] of [
          [first, "Alpha paragraph", "A"],
          [second, "Charlie paragraph", "B"],
        ] as const) {
          await s.tabs.showOnly(tab);
          await typeAtParagraphEnd(tab, anchor, ` ${s.markers.next(label)}`);
          await tab.waitForTimeout(400);
        }
      }
    });
  });

  test("an agent edit between two open tabs keeps every author's text", async ({
    browser,
  }, testInfo) => {
    test.fixme(
      true,
      "QUARANTINED alice until phase 3 lands R11: beta's tabs save over the agent's edit-document text, so this fails every run. Content DB tests still runs the local scenario without blocking (#6656).",
    );
    await runOnBeta("agent-edit", browser, testInfo, async (s) => {
      const first = await s.tabs.open("A", s.id);
      const second = await s.tabs.open("B", s.id);

      await s.tabs.showOnly(first);
      await typeAtParagraphEnd(
        first,
        "Alpha paragraph",
        ` ${s.markers.next("A")}`,
      );
      await s.tabs.waitForSaveAnswers(first, 1);

      const fromAgent = s.markers.next("Agent");
      // The connection's token is revoked right after the edit, so the 6 h
      // schedule leaves no live MCP tokens on the test account.
      s.notes.agentIdentity = await AgentClient.editOnce(
        s.reader,
        s.id,
        "Delta paragraph stays untouched.",
        `Delta paragraph edited by the agent ${fromAgent}.`,
      );
      await s.tabs.showOnly(second);
      await typeAtParagraphEnd(
        second,
        "Charlie paragraph",
        ` ${s.markers.next("B")}`,
      );
      await s.tabs.showOnly(first);
      await typeAtParagraphEnd(
        first,
        "Alpha paragraph",
        ` ${s.markers.next("A")}`,
      );
    });
  });

  test("a background tab returning after several revisions keeps its next edit", async ({
    browser,
  }, testInfo) => {
    await runOnBeta("stale-tab-return", browser, testInfo, async (s) => {
      const first = await s.tabs.open("A", s.id);
      const second = await s.tabs.open("B", s.id);
      await s.tabs.showOnly(first);
      for (let revision = 1; revision <= 4; revision++) {
        await typeAtParagraphEnd(
          first,
          "Alpha paragraph",
          ` ${s.markers.next("A")}`,
        );
        await s.tabs.waitForSaveAnswers(first, revision);
      }
      await s.tabs.showOnly(second);
      await typeAtParagraphEnd(
        second,
        "Charlie paragraph",
        ` ${s.markers.next("B")}`,
      );
    });
  });
});
