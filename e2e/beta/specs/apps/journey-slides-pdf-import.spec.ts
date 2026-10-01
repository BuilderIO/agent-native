import { expect, test, type Page } from "@playwright/test";

import { renderedText } from "../../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";
import {
  callAction,
  describeCall,
  expectJsonOk,
  jsonRequestFromPage,
  journeyToken,
  uploadFromPage,
  withCleanup,
} from "../../lib/journey-browser";
import { buildMinimalPdf } from "../../lib/journey-pdf";

/**
 * Slides PDF upload and import.
 *
 * "Import fails every time" (`permanent_precondition`), 504s on a PDF,
 * "Upload failed", a raw "Import failed: <!DOCTYPE", and "Private file
 * storage is not configured" were reported on 9/2, 9/9, 9/19, 9/26 to 9/30
 * (three times on 9/30) in Slack #product-agent-native-feedback. The 9/9 and
 * 9/28 fixes were each followed by new reports within a day. Production data
 * agrees: `import-file` failed 92 of 99 times, 10 runs killed as
 * `permanent_precondition` (db-b P5).
 *
 * The tiny PDF is built in memory. No model turn is taken.
 *
 *   1. Upload API: the upload returns a handle, and the import action can
 *      resolve that handle back to the file. This is the contract the
 *      private-reference minting and decoding must keep.
 *   2. Import UI: Import > PDF on the deck list creates a deck that opens and
 *      appears in the list.
 *   3. Composer upload endpoint: the endpoint the chat composer sends a file
 *      to returns a URL that serves the file back.
 *
 * Not covered, because it needs a model turn: attaching the PDF in chat and
 * letting the agent call `import-file` on the reference the chat path mints.
 * That is the path users report as failing while the Import control works.
 *
 * These need private file storage on the e2e account. If it is not configured
 * they fail and say so; that is the "Private file storage is not configured"
 * report, not a problem with the test. To accept that state for this account
 * instead, change STORAGE_UNCONFIGURED_FAILS to false.
 */

skipUnlessAuthed();

const STORAGE_UNCONFIGURED_FAILS = true;

const site = siteById("slides");
const origin = originFor(site);

const FORBIDDEN_TEXT =
  /Invalid uploaded file reference|permanent_precondition|Upload failed|<!DOCTYPE|Private file storage is not configured/i;

function whenSelected() {
  test.skip(
    !selectedSites().some((entry) => entry.id === site.id),
    "slides is not in this run's selection",
  );
}

function assertNoForbiddenText(text: string, where: string): void {
  const hit = FORBIDDEN_TEXT.exec(text);
  expect(
    hit,
    `${where} contained ${JSON.stringify(hit?.[0])}, a message users reported: ${text.slice(0, 400)}`,
  ).toBeNull();
}

async function openHealth(page: Page): Promise<void> {
  // A same-origin document with the session cookie, so in-page fetches behave
  // like the app's own, without paying for the whole app to load.
  await page.goto(`${origin}/_agent-native/health`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
}

async function assertStorageReady(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/uploads/status", {
      credentials: "include",
    });
    return { status: response.status, text: await response.text() };
  });
  expect(
    status.status,
    `GET ${origin}/api/uploads/status -> HTTP ${status.status}: ${status.text.slice(0, 300)}`,
  ).toBe(200);
  assertNoForbiddenText(status.text, "GET /api/uploads/status");
  const ready = (JSON.parse(status.text) as { referenceStorageReady?: unknown })
    .referenceStorageReady;
  if (ready !== true && !STORAGE_UNCONFIGURED_FAILS) {
    test.skip(true, "the e2e account has no private file storage configured");
  }
  expect(
    ready,
    `${origin}/api/uploads/status says referenceStorageReady=${String(ready)} for the e2e account. Private file storage is not configured, so every Slides upload and import is refused (the "Connect Builder" / "Private file storage is not configured" report).`,
  ).toBe(true);
}

test.describe.configure({ mode: "parallel" });

test("[journey] [slides-import] slides: a PDF upload returns a handle the import action can resolve", async ({
  browser,
}) => {
  whenSelected();
  test.setTimeout(300_000);
  const token = journeyToken("slides-upload");
  const pdf = buildMinimalPdf([`${token} page one`, `${token} page two`]);
  const context = await signedInContext(browser, site, { seedModel: false });
  const page = await context.newPage();
  let uploadedPath: string | null = null;

  try {
    await withCleanup(
      async () => {
        await assertSignedInOnBeta(context, site);
        await openHealth(page);
        await assertStorageReady(page);

        const upload = await uploadFromPage(page, "/api/uploads", "files", {
          name: `${token}.pdf`,
          type: "application/pdf",
          bytes: pdf,
        });
        assertNoForbiddenText(upload.text, "POST /api/uploads");
        expect(
          upload.status,
          `POST ${origin}/api/uploads of a ${pdf.length}-byte PDF -> HTTP ${upload.status}: ${upload.text.slice(0, 400)}`,
        ).toBeLessThan(300);
        const files = JSON.parse(upload.text) as {
          path?: unknown;
          size?: unknown;
          type?: unknown;
        }[];
        expect(
          Array.isArray(files) && files.length === 1,
          `POST /api/uploads of one file returned ${upload.text.slice(0, 300)}`,
        ).toBe(true);
        const [file] = files;
        if (typeof file?.path !== "string" || !file.path) {
          throw new Error(
            `POST /api/uploads returned no usable path handle: ${upload.text.slice(0, 300)}`,
          );
        }
        uploadedPath = file.path;
        expect(
          file.size,
          `the upload reported ${String(file.size)} bytes for a ${pdf.length}-byte PDF`,
        ).toBe(pdf.length);
        test.info().annotations.push({
          type: "slides-upload-handle",
          description: `path prefix ${JSON.stringify(file.path.slice(0, 18))} (${file.path.length} chars), type ${String(file.type)}`,
        });

        // The handle must resolve back to the file, in the same session.
        const imported = await callAction(page.request, origin, "import-file", {
          method: "POST",
          data: {
            filePath: uploadedPath,
            format: "pdf",
            importIntoDeck: false,
          },
          timeoutMs: 180_000,
        });
        assertNoForbiddenText(
          imported.text,
          `import-file on the handle just minted (${describeCall(imported)})`,
        );
        const result = expectJsonOk<{
          format?: string;
          pageCount?: number;
          pages?: { text?: string }[];
        }>(imported, "import-file on the handle just minted");
        expect(
          [result.format, result.pageCount],
          `import-file resolved the handle but read it back as ${imported.text.slice(0, 300)}`,
        ).toEqual(["pdf", 2]);
        expect(
          JSON.stringify(result.pages ?? []),
          `import-file returned no text from the uploaded PDF: ${imported.text.slice(0, 300)}`,
        ).toContain(token);
      },
      async () => {
        if (!uploadedPath) return [];
        const removed = await jsonRequestFromPage(
          page,
          "DELETE",
          "/api/uploads",
          { path: uploadedPath },
        );
        return removed.status >= 200 && removed.status < 300
          ? []
          : [
              `DELETE /api/uploads for the test upload -> HTTP ${removed.status}: ${removed.text.slice(0, 200)}`,
            ];
      },
    );
  } finally {
    await context.close();
  }
});

test("[journey] [slides-import] slides: Import > PDF creates a deck that opens and appears in the deck list", async ({
  browser,
}) => {
  whenSelected();
  test.setTimeout(600_000);
  const token = journeyToken("slides-import");
  const pdf = buildMinimalPdf([`${token} page one`, `${token} page two`]);
  const context = await signedInContext(browser, site, { seedModel: false });
  const page = await context.newPage();
  const deckIds = new Set<string>();
  page.on("request", (request) => {
    if (
      request.method() !== "POST" ||
      !request.url().includes("/_agent-native/actions/import-file")
    ) {
      return;
    }
    const body = request.postData();
    if (!body) return;
    try {
      const parsed = JSON.parse(body) as { deckId?: unknown };
      if (typeof parsed.deckId === "string") deckIds.add(parsed.deckId);
    } catch {
      // Not JSON: nothing to learn about which deck is being imported into.
    }
  });

  try {
    await withCleanup(
      async () => {
        await assertSignedInOnBeta(context, site);
        const storageStatus = page.waitForResponse(
          (response) => response.url().includes("/api/uploads/status"),
          { timeout: 90_000 },
        );
        storageStatus.catch(() => undefined);
        await page.goto(`${origin}/home`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await renderedText(page, `${site.host} deck list`);
        const status = await storageStatus;
        expect(
          status.status(),
          `the deck list's GET /api/uploads/status -> HTTP ${status.status()}: ${(await status.text()).slice(0, 300)}`,
        ).toBe(200);

        const alertsBefore = new Set(
          await page.getByRole("alert").allInnerTexts(),
        );
        const importButton = page
          .getByRole("button", { name: "Import", exact: true })
          .first();
        await expect(
          importButton,
          `${site.host} /home rendered no Import control`,
        ).toBeVisible({ timeout: 60_000 });
        await importButton.click();

        const chooser = page.waitForEvent("filechooser", { timeout: 20_000 });
        chooser.catch(() => undefined);
        await page.getByRole("menuitem", { name: "PDF", exact: true }).click();
        const fileChooser = await chooser.catch(async (error: unknown) => {
          throw new Error(
            `Import > PDF opened no file picker, which is what the app does when private file storage is not available. Page text: ${JSON.stringify((await page.locator("body").innerText()).slice(0, 400))}. ${error instanceof Error ? error.message : String(error)}`,
          );
        });
        await fileChooser.setFiles({
          name: `${token}.pdf`,
          mimeType: "application/pdf",
          buffer: pdf,
        });

        // The import is done when the editor opens, failed when it says so.
        const deadline = Date.now() + 240_000;
        let deckId: string | null = null;
        let failure: string | null = null;
        while (Date.now() < deadline && !deckId && !failure) {
          const opened = /\/deck\/([^/?#]+)/.exec(new URL(page.url()).pathname);
          if (opened) {
            deckId = decodeURIComponent(opened[1]);
            break;
          }
          for (const text of await page.getByRole("alert").allInnerTexts()) {
            if (text.trim() && !alertsBefore.has(text)) failure = text.trim();
          }
          if (!failure) await page.waitForTimeout(500);
        }
        if (failure) {
          assertNoForbiddenText(failure, "the Import > PDF error");
          throw new Error(
            `Import > PDF failed in the UI at ${page.url()}: ${JSON.stringify(failure)}`,
          );
        }
        if (!deckId) {
          throw new Error(
            `Import > PDF did not open a deck within 240 s; still at ${page.url()}. import-file was requested for deck(s): ${[...deckIds].join(", ") || "(none)"}`,
          );
        }
        deckIds.add(deckId);

        const deck = expectJsonOk<{ slideCount?: unknown }>(
          await callAction(page.request, origin, "get-deck", {
            params: { id: deckId, compact: "true" },
          }),
          `get-deck for the imported deck ${deckId}`,
        );
        expect(
          typeof deck.slideCount === "number" && deck.slideCount >= 1,
          `the imported deck ${deckId} reports slideCount=${String(deck.slideCount)}, expected the PDF's pages as slides`,
        ).toBe(true);
        test.info().annotations.push({
          type: "slides-import",
          description: `deck=${deckId} slideCount=${String(deck.slideCount)}`,
        });

        await page.goto(`${origin}/home`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await expect(
          page.locator(`a[href$="/deck/${deckId}"]`).first(),
          `the imported deck ${deckId} is not in the deck list at ${page.url()}`,
        ).toBeVisible({ timeout: 60_000 });
      },
      async () => {
        const failures: string[] = [];
        for (const id of deckIds) {
          await callAction(page.request, origin, "delete-deck", {
            method: "DELETE",
            data: { id },
          });
        }
        if (deckIds.size > 0) {
          const listed = await callAction(page.request, origin, "list-decks", {
            params: { limit: "100" },
          });
          const remaining = (
            (listed.json as { decks?: { id?: string }[] })?.decks ?? []
          ).filter((deck) => deck.id && deckIds.has(deck.id));
          if (!listed.ok || !listed.parsed) {
            failures.push(
              `could not confirm deck cleanup: ${describeCall(listed)}`,
            );
          } else if (remaining.length > 0) {
            failures.push(
              `deck(s) still listed after delete-deck: ${remaining.map((deck) => deck.id).join(", ")}`,
            );
          }
        }
        return failures;
      },
    );
  } finally {
    await context.close();
  }
});

test("[journey] [slides-import] slides: the chat composer's upload endpoint returns a URL that serves the PDF back", async ({
  browser,
}) => {
  whenSelected();
  test.setTimeout(240_000);
  const token = journeyToken("slides-composer");
  const pdf = buildMinimalPdf([`${token} page one`]);
  const context = await signedInContext(browser, site, { seedModel: false });
  try {
    const page = await context.newPage();
    await assertSignedInOnBeta(context, site);
    await openHealth(page);

    // The composer sends each attached file here when the turn is sent; the
    // URL it gets back is what the agent is later handed.
    const upload = await uploadFromPage(
      page,
      "/_agent-native/file-upload",
      "file",
      { name: `${token}.pdf`, type: "application/pdf", bytes: pdf },
    );
    assertNoForbiddenText(upload.text, "POST /_agent-native/file-upload");
    expect(
      upload.status,
      `POST ${origin}/_agent-native/file-upload of a ${pdf.length}-byte PDF -> HTTP ${upload.status}: ${upload.text.slice(0, 400)}`,
    ).toBe(201);
    const stored = JSON.parse(upload.text) as {
      url?: unknown;
      provider?: unknown;
    };
    if (typeof stored.url !== "string" || !stored.url) {
      throw new Error(
        `the composer upload returned no url: ${upload.text.slice(0, 300)}`,
      );
    }

    const served = await page.request.get(new URL(stored.url, origin).href, {
      timeout: 60_000,
    });
    const bytes = await served.body();
    expect(
      served.status(),
      `GET ${stored.url} (provider ${String(stored.provider)}) -> HTTP ${served.status()}`,
    ).toBe(200);
    expect(
      bytes.subarray(0, 5).toString("ascii"),
      `GET ${stored.url} did not serve the PDF back (${bytes.length} bytes, content-type ${served.headers()["content-type"]})`,
    ).toBe("%PDF-");
    test.info().annotations.push({
      type: "composer-upload",
      description: `provider=${String(stored.provider)} url=${stored.url}`,
    });
  } finally {
    await context.close();
  }
});
