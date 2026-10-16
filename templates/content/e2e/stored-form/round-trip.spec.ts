import { expect, test, type Page } from "@playwright/test";

import { knownLossSpec } from "../../acceptance/known-loss";
import {
  ROUND_TRIP_CORPUS,
  type RoundTripSample,
} from "../../acceptance/round-trip-corpus";
import { canonicalizeNfm } from "../../shared/nfm";
import {
  AgentClient,
  EDITOR,
  createdPageId,
  getDocument,
  gotoEditor,
  postAction,
  typeAtParagraphEnd,
} from "../helpers";
import { enterGateArm } from "../live-body-gate";

// SF-04: every corpus sample survives the trips an agent's page takes. Each
// sample is created over MCP, then either opened in the editor, saved by one
// keystroke in another paragraph and read back, or exported and imported as a
// new page. A sample the stored form cannot represent must be refused when it
// is written instead.

test.describe.configure({ retries: 0, timeout: 150_000 });

// Samples main loses today. L1 drops each entry with the fix that keeps it.
const MAIN_LOSES: Record<string, string> = {
  "escaped-underscore":
    "The editor shows the backslash in snake\\_case instead of an underscore.",
  "underscore-bold": "__bold__ stays literal underscores instead of bold text.",
  "four-space-nested-list":
    'A four-space nested item becomes a top-level paragraph reading "    - Nested item".',
  "two-space-nested-list":
    'A two-space nested item becomes a top-level paragraph reading "  - Nested item".',
};

// Every export fails this before its sample is compared. No lane owns it yet.
const EXPORT_MANIFEST_LOSS =
  "Markdown export appends a hidden agent-native-blocks manifest that import drops, so every exported page re-imports reported as lost and with new block identities.";

const KEYSTROKE_PARAGRAPH = "Keystroke lands here.";
const KEYSTROKE = "!";

// The typed refusal L1 adds for a sample the stored form cannot represent.
// Any error code naming fidelity counts; a generic failure does not.
const FIDELITY_REFUSAL = /\b[A-Z][A-Z_]*FIDELITY[A-Z_]*\b/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectRenders(
  page: Page,
  sample: RoundTripSample,
  where: string,
): Promise<void> {
  for (const { selector, text } of sample.renders) {
    await expect(
      page
        .locator(`${EDITOR} :is(${selector})`)
        .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`) })
        .first(),
      `${where}: the editor shows "${text}" as ${selector}`,
    ).toBeVisible();
  }
}

interface ImportReport {
  storageReady?: boolean;
  counts?: { lost?: number };
  pages?: Array<{
    id: string | null;
    status?: string;
    coverage?: { missingCharacters?: number };
  }>;
}

/** The stored body, once it holds the keystroke the editor saved. */
async function savedBody(page: Page, id: string): Promise<string> {
  let content = "";
  await expect
    .poll(
      async () => {
        content = (await getDocument(page, id)).content ?? "";
        return content.includes(`${KEYSTROKE_PARAGRAPH}${KEYSTROKE}`);
      },
      { message: "the keystroke's save reached the page", timeout: 30_000 },
    )
    .toBe(true);
  return content;
}

/**
 * Create the sample over MCP as an agent would. Returns null when the sample
 * is declared unrepresentable and the server refused it with a typed fidelity
 * error, which is a pass for that sample.
 */
async function createSample(
  agent: AgentClient,
  sample: RoundTripSample,
  title: string,
  content: string,
): Promise<string | null> {
  const created = await agent.call("create-document", { title, content });
  if (!sample.unrepresentable) {
    expect(
      created.isError,
      `the server stores ${sample.id}, which it can represent: ${created.raw}`,
    ).toBe(false);
    return createdPageId(created);
  }
  expect(
    created.isError,
    `the server refuses ${sample.id} at write time: ${sample.unrepresentable}`,
  ).toBe(true);
  expect(
    created.text,
    `a refused sample names its fidelity error: ${created.raw}`,
  ).toMatch(FIDELITY_REFUSAL);
  return null;
}

test.describe("SF-04 round trips keep every sample", { tag: "@SF-04" }, () => {
  let agent: AgentClient;

  test.beforeEach(({ page }) => {
    agent = AgentClient.shared(page);
  });

  for (const sample of ROUND_TRIP_CORPUS) {
    const loss = MAIN_LOSES[sample.id];
    const details = loss
      ? knownLossSpec({ lane: "L1", outcome: "SF-04", reason: loss })
      : {};
    const exportDetails = knownLossSpec({
      lane: loss ? ["unowned", "L1"] : "unowned",
      outcome: "SF-04",
      reason: loss ? `${EXPORT_MANIFEST_LOSS} ${loss}` : EXPORT_MANIFEST_LOSS,
    });

    test(
      `${sample.id}: open, save and read back`,
      details,
      async ({ page, context }) => {
        const sent = `${sample.markdown}\n\n${KEYSTROKE_PARAGRAPH}`;
        const id = await createSample(
          agent,
          sample,
          `SF-04 ${sample.id}`,
          sent,
        );
        if (id === null) return;
        await enterGateArm(page, id);

        const editor = await context.newPage();
        await gotoEditor(editor, id);
        await expectRenders(editor, sample, "first open");
        await typeAtParagraphEnd(editor, KEYSTROKE_PARAGRAPH, KEYSTROKE);
        const saved = await savedBody(page, id);

        const expected = canonicalizeNfm(
          sent.replace(
            KEYSTROKE_PARAGRAPH,
            `${KEYSTROKE_PARAGRAPH}${KEYSTROKE}`,
          ),
        );
        const read = await agent.callJson<{ content?: string }>(
          "get-document",
          { id },
        );
        expect(read.content, "get-document over MCP reads the saved body").toBe(
          saved,
        );
        expect(saved, "the saved body is the canonical form").toBe(expected);
        expect(canonicalizeNfm(saved), "the saved body is a fixed point").toBe(
          saved,
        );
        await editor.reload({ waitUntil: "domcontentloaded" });
        await expectRenders(editor, sample, "after the save");
      },
    );

    test(
      `${sample.id}: export, then import`,
      exportDetails,
      async ({ page, context }) => {
        const id = await createSample(
          agent,
          sample,
          `SF-04 ${sample.id} export`,
          sample.markdown,
        );
        if (id === null) return;
        await enterGateArm(page, id);
        const stored = await agent.callJson<{ content?: string }>(
          "get-document",
          { id },
        );

        // Export is a browser action; MCP does not list it.
        const exported = await postAction<{ content?: string }>(
          page,
          "export-document",
          { id, format: "markdown" },
        );
        expect(exported.content, JSON.stringify(exported)).toEqual(
          expect.any(String),
        );
        // Import answers MCP with a one-line summary, so both calls go
        // through the browser's action, which returns the full report.
        const files = [
          { name: `sf04-${sample.id}.md`, text: exported.content },
        ];
        const preview = await postAction<ImportReport>(page, "import-content", {
          files,
          dryRun: true,
        });
        const evidence = `exported: ${exported.content}\npreview: ${JSON.stringify(preview)}`;
        expect(preview.counts?.lost, evidence).toBe(0);
        expect(
          preview.pages?.map((entry) => entry.coverage?.missingCharacters),
          evidence,
        ).toEqual([0]);
        expect(preview.storageReady, evidence).toEqual(expect.any(Boolean));
        test.skip(
          !preview.storageReady,
          "The dry run reports no loss, but applying an import keeps the original file in private blob storage, and this server has none configured.",
        );
        const imported = await postAction<ImportReport>(
          page,
          "import-content",
          {
            files,
            dryRun: false,
            idempotencyKey: `${id}-sf04-import`,
          },
        );
        const importedId = imported.pages?.find((entry) => entry.id)?.id;
        if (!importedId)
          throw new Error(
            `import-content made no page: ${JSON.stringify(imported)}`,
          );
        const reimported = await agent.callJson<{ content?: string }>(
          "get-document",
          { id: importedId },
        );
        expect(
          reimported.content,
          `export then import keeps the body; exported: ${exported.content}`,
        ).toBe(stored.content);
        const editor = await context.newPage();
        await gotoEditor(editor, importedId);
        await expectRenders(editor, sample, "after export and import");
      },
    );
  }
});
