import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { sourceContentHash } from "../shared/source-workspace.js";
import {
  appPath,
  designFrame,
  resetPersistedCanvasState,
  selectByText,
} from "./helpers";

const LUNA_ORBIT_SOURCE = readFileSync(
  new URL("./fixtures/luna-orbit-after-ai.html", import.meta.url),
  "utf8",
);
const FOLLOWUP_NOTE = "AI follow-up: nested delivery check";

type DesignFile = {
  id: string;
  filename: string;
  content: string;
  updatedAt?: string;
};
type DesignRecord = { files?: DesignFile[] };
type SafeRead<T> =
  | { status: "read"; value: T }
  | { status: "unreadable"; error: string };
type PersistedSourceSnapshot = {
  label: string;
  capturedAt: string;
  fileId: string;
  fileUpdatedAt: string | null;
  versionHash: string;
  source: string;
};
type UpdateFileTrace = {
  requestedAt: string;
  requestUrl: string;
  fileId: string | null;
  expectedVersionHash: string | null;
  submittedHtmlHash: string | null;
  submittedHtml: string | null;
  respondedAt?: string;
  status?: number;
  error?: string;
  persistedBefore?: Omit<PersistedSourceSnapshot, "source">;
  persistedAfter?: Omit<PersistedSourceSnapshot, "source">;
};

function responseError(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error ?? parsed.message;
    return (typeof error === "string" ? error : body).slice(0, 2000);
  } catch {
    return body.slice(0, 2000);
  }
}

function noteMarkup(content: string | null): string {
  return content?.match(/<p class="ai-note"[^>]*>[^<]*<\/p>/)?.[0] ?? "";
}

function titleMarkup(content: string | null): string {
  return content?.match(/<h1 class="title"[^>]*>[^<]*<\/h1>/)?.[0] ?? "";
}

function normalizeTitleSizeMarkup(content: string, baseline: string): string {
  const baselineStyle = titleMarkup(baseline).match(/\sstyle="([^"]*)"/)?.[1];
  return content.replace(
    /(<h1 class="title"[^>]*?)\sstyle="font-size: 40px"([^>]*>Team overview<\/h1>)/,
    (_match, before: string, after: string) =>
      before +
      (baselineStyle === undefined ? "" : ' style="' + baselineStyle + '"') +
      after,
  );
}

function normalizeNoteMarkup(content: string): string {
  return content.replace(
    /<p class="ai-note"[^>]*>([^<]*)<\/p>/,
    '<p class="ai-note">$1</p>',
  );
}

function captureUpdateFileTrace(page: Page) {
  const updateFileTrace: UpdateFileTrace[] = [];
  const tracesByRequest = new WeakMap<object, UpdateFileTrace>();
  const responseTraceTasks: Promise<void>[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "POST" ||
      !request.url().includes("/_agent-native/actions/update-file")
    ) {
      return;
    }
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(request.postData() ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {}
    const submittedHtml =
      typeof payload.content === "string" ? payload.content : null;
    const trace: UpdateFileTrace = {
      requestedAt: new Date().toISOString(),
      requestUrl: request.url(),
      fileId:
        typeof payload.id === "string"
          ? payload.id
          : typeof payload.fileId === "string"
            ? payload.fileId
            : null,
      expectedVersionHash:
        typeof payload.expectedVersionHash === "string"
          ? payload.expectedVersionHash
          : null,
      submittedHtmlHash: submittedHtml
        ? sourceContentHash(submittedHtml)
        : null,
      submittedHtml,
    };
    updateFileTrace.push(trace);
    tracesByRequest.set(request, trace);
  });
  page.on("response", (response) => {
    const trace = tracesByRequest.get(response.request());
    if (!trace) return;
    trace.respondedAt = new Date().toISOString();
    trace.status = response.status();
    responseTraceTasks.push(
      response
        .text()
        .then((body) => {
          if (!response.ok()) trace.error = responseError(body);
        })
        .catch((error) => {
          trace.error = `Could not read response body: ${String(error)}`;
        }),
    );
  });
  page.on("requestfailed", (request) => {
    const trace = tracesByRequest.get(request);
    if (!trace) return;
    trace.respondedAt = new Date().toISOString();
    trace.error =
      request.failure()?.errorText ?? "Request failed without a response";
  });
  return { updateFileTrace, responseTraceTasks };
}

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  return page.request.post(appPath(`/_agent-native/actions/${name}`), {
    data: input,
  });
}

async function actionJson<T>(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<T> {
  const response = await postAction(page, name, input);
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function createDesign(
  page: Page,
  secondScreenContent: string,
): Promise<{
  designId: string;
  firstScreenId: string;
  secondScreenId: string;
}> {
  const created = await actionJson<{ id?: string; data?: { id?: string } }>(
    page,
    "create-design",
    {
      title: `AI continuity final ${Date.now()}`,
      projectType: "prototype",
      designSystemId: null,
    },
  );
  const designId = created.id ?? created.data?.id;
  if (!designId) throw new Error("create-design returned no id");

  const first = await actionJson<{ id?: string }>(page, "create-file", {
    designId,
    filename: "index.html",
    content: LUNA_ORBIT_SOURCE,
    fileType: "html",
  });
  const second = await actionJson<{ id?: string }>(page, "create-file", {
    designId,
    filename: "team.html",
    content: secondScreenContent,
    fileType: "html",
  });
  if (!first.id || !second.id) throw new Error("create-file returned no id");
  return {
    designId,
    firstScreenId: first.id,
    secondScreenId: second.id,
  };
}

async function readDesign(page: Page, designId: string): Promise<DesignRecord> {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  return response.json() as Promise<DesignRecord>;
}

async function readSource(page: Page, designId: string, screenId: string) {
  const design = await readDesign(page, designId);
  const file = design.files?.find((candidate) => candidate.id === screenId);
  if (!file) throw new Error(`Screen ${screenId} is absent from get-design`);
  return file.content;
}

async function sourceState(page: Page, html: string) {
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "text/html");
    const read = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector);
      return node
        ? {
            id: node.getAttribute("data-agent-native-node-id"),
            text: node.textContent?.trim() ?? "",
            inlineFontSize: node.style.fontSize || null,
            style: node.getAttribute("style"),
          }
        : null;
    };
    const note = read(".ai-note");
    const noteCount = document.querySelectorAll(".ai-note").length;
    const noteIdCount = note?.id
      ? Array.from(
          document.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
        ).filter(
          (node) => node.getAttribute("data-agent-native-node-id") === note.id,
        ).length
      : 0;
    return {
      title: read("h1.title"),
      section: read("h2.section-title"),
      task: read(".task-name"),
      note,
      noteCount,
      noteIdCount,
    };
  }, html);
}

async function liveState(page: Page, screenId: string) {
  return designFrame(page, screenId)
    .locator("h1.title, h2.section-title, .task-name, .ai-note")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const element = node as HTMLElement;
        return {
          tag: element.tagName.toLowerCase(),
          id: element.getAttribute("data-agent-native-node-id"),
          text: element.textContent?.trim() ?? "",
          fontSize: getComputedStyle(element).fontSize,
        };
      }),
    );
}

async function lastBridgeSelection(page: Page) {
  return page.evaluate(() => {
    const messages =
      (
        window as unknown as {
          __bridge?: Array<Record<string, unknown>>;
        }
      ).__bridge ?? [];
    return (
      [...messages]
        .reverse()
        .find((message) => message.type === "element-select") ?? null
    );
  });
}

async function installBridgeOwnerCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as unknown as {
      __bridgeScreenSelections?: Array<{
        screenId: string | null;
        message: Record<string, unknown>;
      }>;
    };
    win.__bridgeScreenSelections = [];
    window.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as Record<string, unknown> | null;
      if (!message || message.type !== "element-select") return;
      const iframe = Array.from(
        document.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-screen-iframe-id]",
        ),
      ).find((candidate) => candidate.contentWindow === event.source);
      win.__bridgeScreenSelections?.push({
        screenId: iframe?.getAttribute("data-screen-iframe-id") ?? null,
        message,
      });
    });
  });
}

async function lastBridgeSelectionOwner(page: Page) {
  return page.evaluate(() => {
    const selections =
      (
        window as unknown as {
          __bridgeScreenSelections?: Array<{
            screenId: string | null;
            message: Record<string, unknown>;
          }>;
        }
      ).__bridgeScreenSelections ?? [];
    return selections[selections.length - 1] ?? null;
  });
}

async function attachEvidence(args: {
  page: Page;
  testInfo: TestInfo;
  designId: string;
  screenIds: string[];
  stage: string;
  expectedOwner: string | null;
  selectedOwner: string | null;
  consoleErrors: string[];
  updateFileTrace: UpdateFileTrace[];
  persistedSourceSnapshots: PersistedSourceSnapshot[];
}) {
  const { page, testInfo, designId, screenIds } = args;
  const readSafely = async <T>(
    read: () => Promise<T>,
  ): Promise<SafeRead<T>> => {
    try {
      return { status: "read", value: await read() };
    } catch (error) {
      return { status: "unreadable", error: String(error) };
    }
  };
  const designRead = await readSafely(() => readDesign(page, designId));
  const files =
    designRead.status === "read" ? (designRead.value.files ?? []) : [];
  const screens = await Promise.all(
    screenIds.map(async (screenId) => {
      const file = files.find((candidate) => candidate.id === screenId);
      const iframeCount = await page
        .locator(
          `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
        )
        .count()
        .catch((error) => `unreadable: ${String(error)}`);
      const live = await readSafely(() => liveState(page, screenId));
      return {
        screenId,
        filename: file?.filename ?? null,
        source: file?.content ?? null,
        sourceRead: file ? await sourceState(page, file.content) : null,
        iframeCount,
        live,
      };
    }),
  );
  const selectionState = await readSafely(async () => {
    const response = await page.request.get(
      appPath("/_agent-native/application-state/design-selection"),
    );
    return { status: response.status(), body: await response.text() };
  });
  const bridgeSelection = await readSafely(() => lastBridgeSelection(page));
  const bridgeSelectionOwner = await readSafely(() =>
    lastBridgeSelectionOwner(page),
  );

  const evidencePath = testInfo.outputPath(
    "ai-continuity-source-dom-owner.json",
  );
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        stage: args.stage,
        expectedOwner: args.expectedOwner,
        selectedOwner: args.selectedOwner,
        designRead,
        screens,
        selectionState,
        bridgeSelection,
        bridgeSelectionOwner,
        consoleErrors: args.consoleErrors,
        updateFileTrace: args.updateFileTrace,
        persistedSourceSnapshots: args.persistedSourceSnapshots,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("ai-continuity-source-dom-owner.json", {
    contentType: "application/json",
    path: evidencePath,
  });
}

test("captured Luna Orbit source survives deterministic Screen-scoped and visual edits", async ({
  page,
}, testInfo) => {
  const sourceB = LUNA_ORBIT_SOURCE.replace("Launch overview", "Team overview");
  const { designId, firstScreenId, secondScreenId } = await createDesign(
    page,
    sourceB,
  );
  const consoleErrors: string[] = [];
  const { updateFileTrace, responseTraceTasks } = captureUpdateFileTrace(page);
  const persistedSourceSnapshots: PersistedSourceSnapshot[] = [];
  let stage = "open editor";
  let expectedOwner: string | null = null;
  let selectedOwner: string | null = null;
  const snapshotPersistedSource = async (
    label: string,
  ): Promise<PersistedSourceSnapshot> => {
    const design = await readDesign(page, designId);
    const file = design.files?.find(
      (candidate) => candidate.id === secondScreenId,
    );
    if (!file)
      throw new Error(`Screen ${secondScreenId} is absent from get-design`);
    const snapshot = {
      label,
      capturedAt: new Date().toISOString(),
      fileId: file.id,
      fileUpdatedAt: file.updatedAt ?? null,
      versionHash: sourceContentHash(file.content),
      source: file.content,
    };
    persistedSourceSnapshots.push(snapshot);
    return snapshot;
  };
  const withSourceBracket = async <T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const before = await snapshotPersistedSource(`${label}: before`);
    const traceStart = updateFileTrace.length;
    try {
      return await action();
    } finally {
      const after = await snapshotPersistedSource(`${label}: after`);
      const beforeRef: Omit<PersistedSourceSnapshot, "source"> = {
        label: before.label,
        capturedAt: before.capturedAt,
        fileId: before.fileId,
        fileUpdatedAt: before.fileUpdatedAt,
        versionHash: before.versionHash,
      };
      const afterRef: Omit<PersistedSourceSnapshot, "source"> = {
        label: after.label,
        capturedAt: after.capturedAt,
        fileId: after.fileId,
        fileUpdatedAt: after.fileUpdatedAt,
        versionHash: after.versionHash,
      };
      for (const trace of updateFileTrace.slice(traceStart)) {
        trace.persistedBefore = beforeRef;
        trace.persistedAfter = afterRef;
      }
    }
  };
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await resetPersistedCanvasState(page);
    await page.goto(
      appPath(
        `/design/${designId}?view=overview&screen=${encodeURIComponent(secondScreenId)}`,
      ),
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect(
      designFrame(page, secondScreenId).locator("h1.title"),
    ).toHaveText("Team overview");

    stage = "verify shared authored IDs across Screens";
    const initialA = await readSource(page, designId, firstScreenId);
    const initialB = await readSource(page, designId, secondScreenId);
    const firstTitle = (await sourceState(page, initialA)).title;
    const secondTitle = (await sourceState(page, initialB)).title;
    expect(firstTitle?.id).toBeTruthy();
    expect(secondTitle?.id).toBe(firstTitle?.id);

    stage = "select and visually edit Screen B";
    expectedOwner = secondScreenId;
    await installBridgeOwnerCapture(page);
    const selectedTitle = await selectByText(page, "Team overview", {
      screenId: secondScreenId,
    });
    expect(selectedTitle.sourceId).toBe(secondTitle?.id);
    selectedOwner = (await lastBridgeSelectionOwner(page))?.screenId ?? null;
    expect(selectedOwner).toBe(secondScreenId);
    const titleSize = page.locator('input[aria-label="Size" i]').first();
    await expect(titleSize).toBeVisible();
    const afterFirstVisual = await withSourceBracket(
      "Screen B title inspector edit",
      async () => {
        await titleSize.fill("38");
        await titleSize.press("Enter");
        await expect
          .poll(async () =>
            sourceState(page, await readSource(page, designId, secondScreenId)),
          )
          .toMatchObject({
            title: { id: secondTitle?.id, inlineFontSize: "38px" },
          });
        const content = await readSource(page, designId, secondScreenId);
        expect(await readSource(page, designId, firstScreenId)).toBe(initialA);
        await expect
          .poll(() =>
            designFrame(page, secondScreenId)
              .locator("h1.title")
              .evaluate((node) => getComputedStyle(node).fontSize),
          )
          .toBe("38px");
        return content;
      },
    );

    stage = "reject stale source write and recover from current source";
    const staleContent = initialB.replace("Team overview", "Stale AI rewrite");
    await withSourceBracket(
      "deliberate stale update-file conflict",
      async () => {
        const staleTrace: UpdateFileTrace = {
          requestedAt: new Date().toISOString(),
          requestUrl: appPath("/_agent-native/actions/update-file"),
          fileId: secondScreenId,
          expectedVersionHash: sourceContentHash(initialB),
          submittedHtmlHash: sourceContentHash(staleContent),
          submittedHtml: staleContent,
        };
        updateFileTrace.push(staleTrace);
        const staleWrite = await postAction(page, "update-file", {
          id: secondScreenId,
          content: staleContent,
          expectedVersionHash: sourceContentHash(initialB),
        });
        staleTrace.respondedAt = new Date().toISOString();
        staleTrace.status = staleWrite.status();
        const conflictBody = await staleWrite.text();
        if (!staleWrite.ok()) staleTrace.error = responseError(conflictBody);
        expect(staleWrite.status(), conflictBody).toBe(409);
        await expect
          .poll(() => readSource(page, designId, secondScreenId))
          .toBe(afterFirstVisual);
      },
    );

    const currentAiSource = await withSourceBracket(
      "deterministic Screen B edit-design write",
      async () => {
        const followup = await postAction(page, "edit-design", {
          designId,
          fileId: secondScreenId,
          edits: [
            {
              search:
                '<h2 class="section-title" data-agent-native-node-id="an-wcehu3">My tasks</h2>',
              replace:
                '<h2 class="section-title" data-agent-native-node-id="an-wcehu3">Upcoming work</h2>',
            },
            {
              search:
                '<div class="task-meta" data-agent-native-node-id="an-1j9i244">Design · Product</div>',
              replace: `<div class="task-meta" data-agent-native-node-id="an-1j9i244">Design · Product</div><p class="ai-note">${FOLLOWUP_NOTE}</p>`,
            },
          ],
        });
        const followupBody = await followup.text();
        expect(followup.status(), followupBody).toBe(200);
        await expect
          .poll(async () =>
            sourceState(page, await readSource(page, designId, secondScreenId)),
          )
          .toMatchObject({
            title: { id: secondTitle?.id, inlineFontSize: "38px" },
            section: { text: "Upcoming work" },
            note: { text: FOLLOWUP_NOTE, inlineFontSize: null },
          });
        await expect
          .poll(
            async () => {
              const state = await sourceState(
                page,
                await readSource(page, designId, secondScreenId),
              );
              const id = state.note?.id;
              return (
                state.noteCount === 1 &&
                state.noteIdCount === 1 &&
                !!id &&
                !/^runtime-/i.test(id)
              );
            },
            { timeout: 15_000 },
          )
          .toBe(true);
        const publishedSource = await readSource(
          page,
          designId,
          secondScreenId,
        );
        const publishedState = await sourceState(page, publishedSource);
        expect(publishedState.noteCount).toBe(1);
        expect(publishedState.noteIdCount).toBe(1);
        expect(publishedState.note?.id).toBeTruthy();
        expect(publishedState.note?.id).not.toMatch(/^runtime-/i);
        expect(await readSource(page, designId, firstScreenId)).toBe(initialA);
        await expect(
          designFrame(page, secondScreenId).locator(".ai-note"),
        ).toHaveText(FOLLOWUP_NOTE);
        return publishedSource;
      },
    );
    const currentAiState = await sourceState(page, currentAiSource);
    expect(currentAiState).toMatchObject({
      title: { id: secondTitle?.id, inlineFontSize: "38px" },
      section: { text: "Upcoming work" },
      note: { text: FOLLOWUP_NOTE, inlineFontSize: null },
    });
    expect(currentAiState.noteCount).toBe(1);
    expect(currentAiState.noteIdCount).toBe(1);
    const generatedNoteId = currentAiState.note?.id;
    expect(generatedNoteId).toBeTruthy();
    expect(generatedNoteId).not.toMatch(/^runtime-/i);

    await Promise.all(responseTraceTasks);
    stage = "select published note and edit visual style";
    const selectionTraceStart = updateFileTrace.length;
    const selectedNote = await selectByText(page, FOLLOWUP_NOTE, {
      screenId: secondScreenId,
    });
    expect(selectedNote.sourceId).toBe(generatedNoteId);
    selectedOwner = (await lastBridgeSelectionOwner(page))?.screenId ?? null;
    expect(selectedOwner).toBe(secondScreenId);
    expect(await readSource(page, designId, secondScreenId)).toBe(
      currentAiSource,
    );
    expect(
      updateFileTrace
        .slice(selectionTraceStart)
        .filter((trace) => trace.fileId === secondScreenId),
    ).toHaveLength(0);
    const noteTraceStart = updateFileTrace.length;

    const noteSize = page.locator('input[aria-label="Size" i]').first();
    await expect(noteSize).toBeVisible();
    await noteSize.fill("20");
    await noteSize.press("Enter");
    await expect
      .poll(async () =>
        sourceState(page, await readSource(page, designId, secondScreenId)),
      )
      .toMatchObject({
        title: { id: secondTitle?.id, inlineFontSize: "38px" },
        section: { text: "Upcoming work" },
        note: {
          id: generatedNoteId,
          text: FOLLOWUP_NOTE,
          inlineFontSize: "20px",
        },
      });
    await Promise.all(responseTraceTasks);
    const sizePhaseWrites = updateFileTrace.slice(noteTraceStart);
    const noteWrites = sizePhaseWrites.filter(
      (trace) =>
        trace.fileId === secondScreenId ||
        noteMarkup(trace.submittedHtml).includes(FOLLOWUP_NOTE),
    );
    expect(noteWrites.length).toBeGreaterThan(0);
    expect(
      noteWrites.filter((trace) => trace.fileId !== secondScreenId),
    ).toEqual([]);
    const sizeWrites = noteWrites.filter((trace) =>
      /font-size:\s*20px/.test(noteMarkup(trace.submittedHtml)),
    );
    expect(sizeWrites.length).toBeGreaterThan(0);
    expect(sizeWrites).toHaveLength(noteWrites.length);
    const acceptedSizeWrites = sizeWrites.filter(
      (trace) => trace.status === 200,
    );
    const abortedSizeWrites = sizeWrites.filter(
      (trace) => trace.status == null && /ERR_ABORTED/.test(trace.error ?? ""),
    );
    expect(acceptedSizeWrites.length).toBeGreaterThan(0);
    expect(
      sizeWrites.filter(
        (trace) => trace.status !== 200 && !abortedSizeWrites.includes(trace),
      ),
    ).toEqual([]);
    for (const trace of sizeWrites) {
      const markup = noteMarkup(trace.submittedHtml);
      expect(markup).toContain(
        `data-agent-native-node-id="${generatedNoteId}"`,
      );
      expect(markup).toMatch(/font-size:\s*20px/);
      expect(normalizeNoteMarkup(trace.submittedHtml ?? "")).toBe(
        normalizeNoteMarkup(currentAiSource),
      );
    }
    for (const trace of abortedSizeWrites) {
      expect(
        acceptedSizeWrites.some(
          (accepted) =>
            accepted.expectedVersionHash === trace.expectedVersionHash &&
            accepted.submittedHtmlHash === trace.submittedHtmlHash,
        ),
      ).toBe(true);
    }
    expect(
      acceptedSizeWrites.some(
        (trace) =>
          trace.expectedVersionHash === sourceContentHash(currentAiSource),
      ),
    ).toBe(true);

    const persistedNoteSnapshot = await snapshotPersistedSource(
      "unbracketed note edit persisted",
    );
    const persistedNoteState = await sourceState(
      page,
      persistedNoteSnapshot.source,
    );
    expect(normalizeNoteMarkup(persistedNoteSnapshot.source)).toBe(
      normalizeNoteMarkup(currentAiSource),
    );
    const persistedNoteId = persistedNoteState.note?.id;
    expect(persistedNoteId).toBe(generatedNoteId);
    expect(persistedNoteId).not.toMatch(/^runtime-/i);
    expect(persistedNoteState.noteCount).toBe(1);
    expect(persistedNoteState.noteIdCount).toBe(1);
    expect(await readSource(page, designId, firstScreenId)).toBe(initialA);
    await expect
      .poll(() =>
        designFrame(page, secondScreenId)
          .locator(".ai-note")
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("20px");

    stage = "reload and verify both Screen owners";
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        designFrame(page, secondScreenId)
          .locator("h1.title")
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("38px");
    await expect
      .poll(() =>
        designFrame(page, secondScreenId)
          .locator(".ai-note")
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("20px");
    await expect
      .poll(async () =>
        sourceState(page, await readSource(page, designId, secondScreenId)),
      )
      .toMatchObject({
        title: { id: secondTitle?.id, inlineFontSize: "38px" },
        section: { text: "Upcoming work" },
        note: {
          id: persistedNoteId,
          text: FOLLOWUP_NOTE,
          inlineFontSize: "20px",
        },
      });
    await expect
      .poll(() =>
        designFrame(page, firstScreenId)
          .locator("h1.title")
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("36px");
    expect(await readSource(page, designId, firstScreenId)).toBe(initialA);
    expect(
      consoleErrors.filter((message) =>
        /not found in sourceHtml|runtime-[^\s"']+[^\n]*not found|ambiguous/i.test(
          message,
        ),
      ),
    ).toEqual([]);
    await expect(
      page.getByText(/not found in sourceHtml|ambiguous/i),
    ).toHaveCount(0);
  } finally {
    await Promise.all(responseTraceTasks);
    await attachEvidence({
      page,
      testInfo,
      designId,
      screenIds: [firstScreenId, secondScreenId],
      stage,
      expectedOwner,
      selectedOwner,
      consoleErrors,
      updateFileTrace,
      persistedSourceSnapshots,
    });
    await actionJson(page, "delete-design", { id: designId });
  }
});

test("captured Luna Orbit inspector Size edit survives immediate reload after Enter", async ({
  page,
}, testInfo) => {
  const sourceB = LUNA_ORBIT_SOURCE.replace("Launch overview", "Team overview");
  const { designId, secondScreenId } = await createDesign(page, sourceB);
  const { updateFileTrace, responseTraceTasks } = captureUpdateFileTrace(page);
  let stage = "open Screen B";
  let sourceBeforeEdit: string | null = null;
  let sourceAfterReload: string | null = null;
  let editTraceStart = 0;
  let afterEnterAt: string | null = null;
  let reloadStartedAt: string | null = null;

  try {
    await resetPersistedCanvasState(page);
    await page.goto(
      appPath(
        `/design/${designId}?view=overview&screen=${encodeURIComponent(secondScreenId)}`,
      ),
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect(
      designFrame(page, secondScreenId).locator("h1.title"),
    ).toHaveText("Team overview");
    sourceBeforeEdit = await readSource(page, designId, secondScreenId);
    expect(await sourceState(page, sourceBeforeEdit)).toMatchObject({
      title: { text: "Team overview" },
    });

    await selectByText(page, "Team overview", { screenId: secondScreenId });
    const titleSize = page.locator('input[aria-label="Size" i]').first();
    await expect(titleSize).toBeVisible();

    stage = "press Enter then reload without a settle wait";
    editTraceStart = updateFileTrace.length;
    await titleSize.fill("40");
    await titleSize.press("Enter");
    afterEnterAt = new Date().toISOString();
    reloadStartedAt = new Date().toISOString();
    await page.reload({ waitUntil: "domcontentloaded" });

    stage = "verify persisted and rendered title after immediate reload";
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        sourceState(page, await readSource(page, designId, secondScreenId)),
      )
      .toMatchObject({
        title: { text: "Team overview", inlineFontSize: "40px" },
      });
    sourceAfterReload = await readSource(page, designId, secondScreenId);
    expect(
      normalizeTitleSizeMarkup(sourceAfterReload, sourceBeforeEdit ?? ""),
    ).toBe(sourceBeforeEdit);
    await expect
      .poll(() =>
        designFrame(page, secondScreenId)
          .locator("h1.title")
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("40px");

    await Promise.all(responseTraceTasks);
    const sizeWrites = updateFileTrace
      .slice(editTraceStart)
      .filter(
        (trace) =>
          trace.fileId === secondScreenId &&
          /font-size:\s*40px/.test(titleMarkup(trace.submittedHtml)),
      );
    expect(sizeWrites.length).toBeGreaterThan(0);
    expect(
      new Set(
        sizeWrites.map((trace) =>
          JSON.stringify([trace.expectedVersionHash, trace.submittedHtmlHash]),
        ),
      ).size,
    ).toBe(1);
  } finally {
    await Promise.all(responseTraceTasks);
    let finalSourceRead: SafeRead<string>;
    try {
      const content =
        sourceAfterReload ?? (await readSource(page, designId, secondScreenId));
      finalSourceRead = { status: "read", value: content };
    } catch (error) {
      finalSourceRead = { status: "unreadable", error: String(error) };
    }
    const evidencePath = testInfo.outputPath("inspector-immediate-reload.json");
    await writeFile(
      evidencePath,
      JSON.stringify(
        {
          stage,
          designId,
          screenId: secondScreenId,
          sourceBeforeEdit,
          sourceBeforeEditHash: sourceBeforeEdit
            ? sourceContentHash(sourceBeforeEdit)
            : null,
          afterEnterAt,
          reloadStartedAt,
          sourceAfterReload: finalSourceRead,
          updateFileTrace,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("inspector-immediate-reload.json", {
      contentType: "application/json",
      path: evidencePath,
    });
    await actionJson(page, "delete-design", { id: designId });
  }
});
