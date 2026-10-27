import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  AgentClient,
  createPage,
  EDITOR,
  EDITOR_BODY,
  getDocument,
  integrityFailures,
  Markers,
  noiseFailures,
  observeIntegrity,
  PAGE_PARAGRAPHS,
  RequestGate,
  SaveGate,
  TabSet,
  typeAtParagraphEnd,
  writeScenarioRecord,
  type ScenarioRecord,
} from "../helpers";

// SF-02: an agent's edit lands while a tab saves something other than the
// body. The title save answers with the page's current body revision, which
// already names the agent's body; the tab has not read that body yet. Each
// case requires the tab to show the agent's edit once its read lands, every
// later typing save to be written rather than refused, and the agent's edit
// and every typed word to survive in SQL, on refresh and in a tab opened
// alone.

test.describe.configure({ retries: 0, timeout: 180_000 });

const [ALPHA, BRAVO, , DELTA] = PAGE_PARAGRAPHS;

const SHOW_WITHIN_MS = 15_000;
const SAVED_WITHIN_MS = 30_000;

interface Case {
  tabs: TabSet;
  tab: Page;
  reads: RequestGate;
  markers: Markers;
  reader: Page;
  id: string;
  agentMarker: string;
  notes: Record<string, unknown>;
}

async function expectEverySaveWritten(tabs: TabSet, tab: Page) {
  await tabs.settled();
  const record = tabs.record(tab);
  expect(record.saveCodes, "a save refused, or sent to History").toEqual({});
  expect(record.saveOutcomes, "every save written").toEqual({
    written: expect.any(Number),
  });
}

/** Type one new word and wait until SQL holds it. */
async function typeAndSave(scenario: Case) {
  const { tab, reader, id, markers } = scenario;
  const marker = markers.next("A");
  await typeAtParagraphEnd(tab, ALPHA, ` ${marker}`);
  await expect
    .poll(async () => (await getDocument(reader, id)).content ?? "", {
      message: `the save of ${marker} reaches SQL`,
      timeout: SAVED_WITHIN_MS,
    })
    .toContain(marker);
}

/**
 * Open the page in one tab, let an agent edit it while the tab's reads are
 * held, then rename the page so the title save answers with the agent's body
 * revision before the tab has read the agent's body.
 */
async function titleSaveAfterAgentEdit(
  name: string,
  context: BrowserContext,
): Promise<Case> {
  const tabs = await TabSet.create(context);
  const reader = await context.newPage();
  const id = await createPage(reader, `SF-02 ${name}`, EDITOR_BODY);
  const markers = new Markers();
  const notes: Record<string, unknown> = {};
  const tab = await tabs.open("A", id);
  await tabs.showOnly(tab);

  const reads = await RequestGate.action(tab, "get-document");
  reads.hold();
  const agentMarker = markers.next("Agent");
  notes.agentIdentity = await AgentClient.editOnce(
    reader,
    id,
    DELTA,
    `Delta paragraph edited by the agent ${agentMarker}.`,
  );
  const agentRevision = (await getDocument(reader, id)).revision;

  const titleSaved = tab.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/_agent-native/actions/update-document" &&
      response.request().method() === "POST",
  );
  await tab.getByLabel("Document title").fill(`Renamed ${id.slice(0, 8)}`);
  const titleResponse = await titleSaved;
  expect(
    JSON.parse(titleResponse.request().postData() ?? "{}").content,
    "the title save sends no body",
  ).toBeUndefined();
  expect(
    ((await titleResponse.json()) as { revision?: string }).revision,
    "the title save answers with the agent's body revision",
  ).toBe(agentRevision);
  await expectEverySaveWritten(tabs, tab);
  await expect(
    tab.locator(EDITOR),
    "the tab has not read the agent's edit before its reads are released",
  ).not.toContainText(agentMarker);

  return { tabs, tab, reads, markers, reader, id, agentMarker, notes };
}

async function releaseReads(scenario: Case) {
  const read = scenario.tab.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        "/_agent-native/actions/get-document" && response.status() === 200,
  );
  await scenario.reads.release();
  await read;
}

async function finish(
  name: string,
  testInfo: TestInfo,
  scenario: Case,
  started: number,
) {
  const { tabs, reader, id, markers, notes } = scenario;
  const integrity = await observeIntegrity(tabs, reader, id, markers);
  const record: ScenarioRecord = {
    scenario: name,
    tags: testInfo.tags,
    notes,
    build: process.env.CONTENT_CONVERGENCE_BUILD ?? "local",
    authoredEdits: markers.all.length + markers.removed.length,
    markers: markers.all.length,
    durationMs: Date.now() - started,
    integrity,
    tabs: [...tabs.tabs.values(), tabs.detached],
  };
  writeScenarioRecord(testInfo, record);
  await testInfo.attach("convergence", {
    body: JSON.stringify(record, null, 2),
    contentType: "application/json",
  });
  expect(
    integrityFailures(record),
    "lost, duplicated or deleted-then-back text",
  ).toEqual([]);
  expect(
    noiseFailures(record.tabs),
    "recovery notices, error toasts or saves sent to History",
  ).toEqual([]);
}

test.describe("SF-02 a title save answers with an agent's newer body", () => {
  test(
    "the tab shows the agent's edit once its read lands, and typing after it saves",
    { tag: "@SF-02" },
    async ({ context }, testInfo) => {
      const started = Date.now();
      const scenario = await titleSaveAfterAgentEdit("read-then-type", context);
      const { tabs, tab, agentMarker } = scenario;

      await releaseReads(scenario);
      await expect(
        tab.locator(EDITOR),
        "the tab shows the agent's edit once its read lands",
      ).toContainText(agentMarker, { timeout: SHOW_WITHIN_MS });

      await typeAndSave(scenario);
      await typeAndSave(scenario);
      await expectEverySaveWritten(tabs, tab);

      await finish(
        "sf02-title-save-newer-body-read-then-type",
        testInfo,
        scenario,
        started,
      );
    },
  );

  test(
    "typing while the read lands leaves the tab on the agent's body",
    { tag: "@SF-02" },
    async ({ context }, testInfo) => {
      const started = Date.now();
      const scenario = await titleSaveAfterAgentEdit(
        "type-during-read",
        context,
      );
      const { tabs, tab, markers, agentMarker } = scenario;
      const saves = await SaveGate.install(tab);

      // The typed save is on its way when the read lands, so the editor
      // cannot take the read's body then. It must not stay on the old body
      // once that save answers. Starting a save cancels the page reads under
      // way, so the read that lands is the one a second agent edit prompts
      // after the save has started.
      saves.holdArrivals();
      const held = markers.next("A");
      await typeAtParagraphEnd(tab, ALPHA, ` ${held}`);
      await saves.waitForHeld();
      const readDuringSave = tab.waitForRequest(
        (request) =>
          new URL(request.url()).pathname ===
          "/_agent-native/actions/get-document",
        { timeout: SAVED_WITHIN_MS },
      );
      const secondAgentMarker = markers.next("Agent");
      await AgentClient.editOnce(
        scenario.reader,
        scenario.id,
        BRAVO,
        `Bravo paragraph edited by the agent ${secondAgentMarker}.`,
      );
      await readDuringSave;
      saves.pass();
      await releaseReads(scenario);
      expect(saves.queued, "the typed save is still held").toBeGreaterThan(0);
      await saves.release();
      await expect
        .poll(
          async () =>
            (await getDocument(scenario.reader, scenario.id)).content ?? "",
          {
            message: `the held save of ${held} reaches SQL`,
            timeout: SAVED_WITHIN_MS,
          },
        )
        .toContain(held);
      for (const marker of [agentMarker, secondAgentMarker])
        await expect(
          tab.locator(EDITOR),
          "the tab shows both agent edits after the save it held answers",
        ).toContainText(marker, { timeout: SHOW_WITHIN_MS });

      await typeAndSave(scenario);
      await expectEverySaveWritten(tabs, tab);

      await finish(
        "sf02-title-save-newer-body-type-during-read",
        testInfo,
        scenario,
        started,
      );
    },
  );
});
