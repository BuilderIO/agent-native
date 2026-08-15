import { readFileSync } from "node:fs";
import path from "node:path";

import { runWithRequestContext } from "@agent-native/core/server/request-context";

const DIR =
  "/Users/steve/Projects/builder/agent-native/framework/templates/slides/data/uploads/8d88f02d8c4cd6719fac1e81";

const FILES = [
  "slidesmania-canyon.pptx",
  "creandum-board-deck-template.pptx",
  "creative-circus-brand-style-guide.pptx",
  "games-fund-game-company-pitch-deck.pptx",
  "slidesmania-infographics-set1.pptx",
  "slidesmania-infographics-set2.pptx",
  "nicest-pitch-deck-template.pptx",
  "posette-keynote-2024.pptx",
  "slidesmania-raven.pptx",
  "slidesmania-soze.pptx",
  "superteam-brand-guidelines.pptx",
];

async function main() {
  const { getDb, schema } = await import("../server/db/index.js");
  const { importPptxBufferToDeck } = await import("../actions/import-pptx.js");
  const getDeck = (await import("../actions/get-deck.js")).default as {
    run: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  const { parsePptx } = await import(
    "../server/handlers/import/pptx-parser.js"
  );

  const db = getDb();
  const existing = await db.select().from(schema.decks).limit(1);
  const owner = (existing[0]?.ownerEmail as string) ?? "steve@builder.io";
  const orgId = (existing[0]?.orgId as string | null) ?? undefined;
  process.stderr.write(`context owner=${owner} org=${orgId ?? "none"}\n`);

  const rows: Array<Record<string, unknown>> = [];

  for (const file of FILES) {
    const buffer = readFileSync(path.join(DIR, file));
    const name = file.replace(/\.pptx$/, "");
    let parsedSlideCount: number | string = "?";
    let parsedTablesDegraded: number | string = "?";
    try {
      const parsed = await parsePptx(buffer);
      parsedSlideCount = parsed.slides.length;
      parsedTablesDegraded = parsed.slides.reduce(
        (sum, s) => sum + (s.tablesDegraded ?? 0),
        0,
      );
    } catch (error) {
      parsedSlideCount = `parse-failed: ${(error as Error).message}`;
    }

    try {
      const result = (await runWithRequestContext(
        { userEmail: owner, orgId },
        () =>
          importPptxBufferToDeck({
            fileBuffer: buffer,
            title: `sweep-${name}`,
            source: "regression-sweep",
          }),
      )) as {
        id: string;
        slideCount: number;
        imagesSkipped?: number;
        tablesDegraded?: number;
      };

      const deck = (await runWithRequestContext(
        { userEmail: owner, orgId },
        () => getDeck.run({ id: result.id, compact: "false" }),
      )) as {
        slides?: Array<{ content?: string }>;
        sourceImport?: Record<string, unknown>;
      };

      const htmlBytes = (deck.slides ?? []).reduce(
        (sum, slide) => sum + (slide.content?.length ?? 0),
        0,
      );

      rows.push({
        deck: name,
        status: "ok",
        deckId: result.id,
        slideCount: result.slideCount,
        parsedSlideCount,
        imagesSkipped: result.imagesSkipped ?? 0,
        tablesDegraded: result.tablesDegraded ?? 0,
        parsedTablesDegraded,
        htmlBytes,
        fidelity: deck.sourceImport?.fidelity ?? null,
        sourceImport: deck.sourceImport
          ? {
              fidelity: deck.sourceImport.fidelity,
              imagesSkipped: deck.sourceImport.imagesSkipped ?? 0,
              tablesDegraded: deck.sourceImport.tablesDegraded ?? 0,
            }
          : null,
      });
      process.stderr.write(
        `ok ${name} slides=${result.slideCount} html=${(htmlBytes / 1024).toFixed(0)}KB\n`,
      );
    } catch (error) {
      rows.push({
        deck: name,
        status: "FAILED",
        error: (error as Error).message,
        parsedSlideCount,
        parsedTablesDegraded,
      });
      process.stderr.write(`FAILED ${name}: ${(error as Error).message}\n`);
    }
  }

  process.stdout.write(`\n__RESULTS__\n${JSON.stringify(rows, null, 2)}\n`);
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`sweep crashed: ${(error as Error).stack}\n`);
    process.exit(1);
  },
);
