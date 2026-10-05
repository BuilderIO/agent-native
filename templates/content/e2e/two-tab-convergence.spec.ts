import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  AGENT_MARKDOWN_BODY,
  AgentClient,
  createPage,
  delay,
  EDITOR,
  EDITOR_BODY,
  expectEditorReady,
  integrityFailures,
  Markers,
  observeIntegrity,
  SaveGate,
  SessionGate,
  TabSet,
  typeAtParagraphEnd,
  writeScenarioRecord,
  type ScenarioRecord,
} from "./helpers";

// These scenarios count how often two tabs disagree. A retry would hide
// exactly the intermittent failures they exist to count.
test.describe.configure({ retries: 0, timeout: 300_000 });

const BUILD = process.env.CONTENT_CONVERGENCE_BUILD ?? "local";

// SESSION_RESULT_LIFETIME_MS in core's client-status-requests.ts.
const SESSION_LIFETIME_MS = 30_000;

// About what a Netlify function adds to a save. Override to bisect timing.
const SAVE_LATENCY_MS = Number(
  process.env.CONTENT_CONVERGENCE_SAVE_LATENCY_MS ?? 2_000,
);

interface Scenario {
  tabs: TabSet;
  id: string;
  markers: Markers;
  reader: Page;
  notes: Record<string, unknown>;
}

async function runScenario(
  name: string,
  testInfo: TestInfo,
  context: BrowserContext,
  body: (scenario: Scenario) => Promise<void>,
  content = EDITOR_BODY,
) {
  const started = Date.now();
  const tabs = await TabSet.create(context);
  const reader = await context.newPage();
  const id = await createPage(reader, `Convergence ${name}`, content);
  const scenario: Scenario = {
    tabs,
    id,
    markers: new Markers(),
    reader,
    notes: {},
  };
  await body(scenario);
  const working = [...tabs.tabs.values()];
  const integrity = await observeIntegrity(
    tabs,
    reader,
    id,
    scenario.markers.all,
  );
  const record: ScenarioRecord = {
    scenario: name,
    tags: testInfo.tags,
    notes: scenario.notes,
    build: BUILD,
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
  // The lane fails if it did not run under the conditions it reports.
  const latency = Number(scenario.notes.saveLatencyMs ?? 0);
  for (const tab of working) {
    expect(
      tab.editorMounts,
      `${tab.label} reported no editor mount, so its toasts and recovery UI went uncounted`,
    ).toBeGreaterThan(0);
    expect(
      tab.realtimeRefusals,
      `${tab.label} never asked for the realtime stream, so it did not run beta's poll path`,
    ).toBeGreaterThan(0);
    expect(
      tab.realtimeStreams,
      `${tab.label} opened a realtime stream the lane should have refused`,
    ).toBe(0);
    if (latency > 0 && tab.saveDurationsMs.length)
      expect(
        Math.min(...tab.saveDurationsMs),
        `${tab.label} answered a save faster than the ${latency} ms latency`,
      ).toBeGreaterThanOrEqual(latency * 0.9);
  }
  if (latency > 0)
    expect(
      working.some((tab) => tab.saveDurationsMs.length),
      "no save was timed under the latency",
    ).toBe(true);
  expect(integrityFailures(record), "lost or duplicated text").toEqual([]);
}

async function openPair(s: Scenario, latencyMs = SAVE_LATENCY_MS) {
  const first = await s.tabs.open("A", s.id);
  const second = await s.tabs.open("B", s.id);
  const gates = {
    first: await SaveGate.install(first),
    second: await SaveGate.install(second),
  };
  gates.first.setLatency(latencyMs);
  gates.second.setLatency(latencyMs);
  s.notes.saveLatencyMs = latencyMs;
  return { first, second, gates };
}

async function alternate(s: Scenario) {
  const { first, second } = await openPair(s);
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
}

test.describe("two tabs editing one page at beta cadence", () => {
  test("both tabs fall back to the 12 s poll when the stream answers 204", async ({
    context,
  }, testInfo) => {
    await runScenario("poll-cadence", testInfo, context, async (s) => {
      const { first, second } = await openPair(s, 0);
      await s.tabs.showAll();
      await delay(5_000);
      const windowStart = Date.now();
      await delay(30_000);
      for (const page of [first, second]) {
        const polls = s.tabs
          .record(page)
          .collabPollTimes.filter((at) => at >= windowStart).length;
        s.notes[`collabPolls30s${s.tabs.record(page).label}`] = polls;
        // 12 s polling makes two or three requests in 30 s; the 2 s
        // fallback would make fifteen.
        expect(polls, "collaboration polls in 30 s").toBeGreaterThanOrEqual(1);
        expect(polls, "collaboration polls in 30 s").toBeLessThanOrEqual(4);
      }
      await typeAtParagraphEnd(
        first,
        "Alpha paragraph",
        ` ${s.markers.next("A")}`,
      );
      await typeAtParagraphEnd(
        second,
        "Charlie paragraph",
        ` ${s.markers.next("B")}`,
      );
    });
  });

  test("a save landing in one tab keeps the other tab's newer unsaved edit", async ({
    context,
  }, testInfo) => {
    await runScenario("retention-race", testInfo, context, async (s) => {
      const { first, second, gates } = await openPair(s, 0);
      await s.tabs.showOnly(second);
      gates.second.holdArrivals();
      await typeAtParagraphEnd(
        second,
        "Charlie paragraph",
        ` ${s.markers.next("B")}`,
      );
      await gates.second.waitForHeld();

      await s.tabs.showOnly(first);
      const fromFirst = s.markers.next("A");
      await typeAtParagraphEnd(first, "Alpha paragraph", ` ${fromFirst}`);
      await s.tabs.waitForSaveAnswers(first, 1);

      await s.tabs.showOnly(second);
      await s.tabs.waitForText(second, fromFirst);
      gates.second.pass();
      await gates.second.release();
      await typeAtParagraphEnd(
        second,
        "Charlie paragraph",
        ` ${s.markers.next("B")}`,
      );
      s.notes.heldSaves = gates.second.heldCount;
    });
  });

  test("another tab's edit arriving while a save is in flight keeps both", async ({
    context,
  }, testInfo) => {
    await runScenario("in-flight-race", testInfo, context, async (s) => {
      const { first, second, gates } = await openPair(s, 0);
      await s.tabs.showOnly(first);
      gates.first.holdAnswers();
      await typeAtParagraphEnd(
        first,
        "Alpha paragraph",
        ` ${s.markers.next("A")}`,
      );
      await gates.first.waitForHeld();

      await s.tabs.showOnly(second);
      const fromSecond = s.markers.next("B");
      await typeAtParagraphEnd(second, "Charlie paragraph", ` ${fromSecond}`);
      await s.tabs.waitForSaveAnswers(second, 1);

      await s.tabs.showOnly(first);
      await s.tabs.waitForText(first, fromSecond);
      gates.first.pass();
      await gates.first.release();
      await typeAtParagraphEnd(
        first,
        "Alpha paragraph",
        ` ${s.markers.next("A")}`,
      );
      s.notes.heldSaves = gates.first.heldCount;
    });
  });

  test("leaving with a save pending and returning before the session is known keeps the text", async ({
    context,
  }, testInfo) => {
    await runScenario(
      "leave-return-session-pending",
      testInfo,
      context,
      async (s) => {
        const tab = await s.tabs.open("A", s.id);
        const saves = await SaveGate.install(tab);
        const session = await SessionGate.install(tab);
        await s.tabs.showOnly(tab);

        saves.holdArrivals();
        await typeAtParagraphEnd(
          tab,
          "Alpha paragraph",
          ` ${s.markers.next("A")}`,
        );
        await saves.waitForHeld();
        // In-app navigation, as clicking the sidebar does; a full load waits
        // for the session before rendering any page. The sidebar pages its
        // page list, so a page link may not be loaded; Trash always is.
        const trash = tab.getByRole("link", { name: "Trash", exact: true });
        await trash.click();
        await expect(trash).toHaveAttribute("aria-current", "page");
        // Outlast the browser's 30 s session answer, so returning re-reads it.
        await delay(SESSION_LIFETIME_MS + 1_000);

        saves.pass();
        session.hold();
        await tab.goBack();
        await expect(tab).toHaveURL(new RegExp(`/page/${s.id}`));
        // An editor shown before the held session read returns is where #6366
        // lost the word, so text typed then must still be kept.
        const shownBeforeSession = await tab
          .locator(`${EDITOR}[contenteditable=true]`)
          .waitFor({ timeout: 4_000 })
          .then(
            () => true,
            () => false,
          );
        s.notes.shownBeforeSession = shownBeforeSession;
        s.notes.heldSessionReads = session.queued;
        await saves.release();
        if (shownBeforeSession)
          await typeAtParagraphEnd(
            tab,
            "Charlie paragraph",
            ` ${s.markers.next("A")}`,
          );
        await session.release();
        await expectEditorReady(tab);
        if (!shownBeforeSession)
          await typeAtParagraphEnd(
            tab,
            "Charlie paragraph",
            ` ${s.markers.next("A")}`,
          );
        s.notes.heldSaves = saves.heldCount;
      },
    );
  });

  test("alternating edits in different paragraphs keep both tabs' text", async ({
    context,
  }, testInfo) => {
    await runScenario("alternating", testInfo, context, alternate);
  });

  test("alternating edits on a page an agent wrote keep both tabs' text", async ({
    context,
  }, testInfo) => {
    await runScenario(
      "alternating-agent-page",
      testInfo,
      context,
      alternate,
      AGENT_MARKDOWN_BODY,
    );
  });

  test("simultaneous edits in different paragraphs keep both tabs' text", async ({
    context,
  }, testInfo) => {
    await runScenario("simultaneous", testInfo, context, async (s) => {
      const { first, second } = await openPair(s);
      await s.tabs.showAll();
      for (let cycle = 1; cycle <= 4; cycle++) {
        await Promise.all([
          typeAtParagraphEnd(
            first,
            "Alpha paragraph",
            ` ${s.markers.next("A")}`,
          ),
          typeAtParagraphEnd(
            second,
            "Charlie paragraph",
            ` ${s.markers.next("B")}`,
          ),
        ]);
        await first.waitForTimeout(400);
      }
    });
  });

  test("typing across the 500 ms autosave pause keeps every word", async ({
    context,
  }, testInfo) => {
    await runScenario("autosave-boundary", testInfo, context, async (s) => {
      const { first, second } = await openPair(s);
      for (let cycle = 1; cycle <= 2; cycle++) {
        await s.tabs.showOnly(first);
        // Pauses just past the debounce send a save mid-word while the
        // previous one is still in flight.
        await typeAtParagraphEnd(
          first,
          "Alpha paragraph",
          ` ${s.markers.next("A")}`,
          600,
        );
        await s.tabs.showOnly(second);
        await typeAtParagraphEnd(
          second,
          "Charlie paragraph",
          ` ${s.markers.next("B")}`,
          600,
        );
      }
    });
  });

  test("a background tab returning after several revisions keeps its next edit", async ({
    context,
  }, testInfo) => {
    await runScenario("stale-tab-return", testInfo, context, async (s) => {
      const { first, second } = await openPair(s);
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

  test("switching away and back ten times while typing keeps every word", async ({
    context,
  }, testInfo) => {
    await runScenario("switch-back-cycles", testInfo, context, async (s) => {
      const { first, second } = await openPair(s);
      for (let cycle = 1; cycle <= 10; cycle++) {
        await s.tabs.showOnly(first);
        await typeAtParagraphEnd(
          first,
          "Alpha paragraph",
          ` ${s.markers.next("A")}`,
        );
        await s.tabs.showOnly(second);
        await second.waitForTimeout(300);
      }
      await s.tabs.showOnly(first);
    });
  });

  test("an agent edit between two open tabs keeps every author's text", async ({
    context,
  }, testInfo) => {
    await runScenario("agent-edit", testInfo, context, async (s) => {
      const { first, second } = await openPair(s);

      await s.tabs.showOnly(first);
      await typeAtParagraphEnd(
        first,
        "Alpha paragraph",
        ` ${s.markers.next("A")}`,
      );
      await s.tabs.waitForSaveAnswers(first, 1);

      const fromAgent = s.markers.next("Agent");
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
});
