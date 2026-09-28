import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { pick, resolvePnpmEntry } from "./resolve-pkg.ts";

const BASE_URL = process.env.SLIDES_BASE_URL ?? "http://localhost:3106";

function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function main() {
  let deckId = process.argv.includes("--fixture") ? "" : arg("--deck");
  const outDir = path.resolve(arg("--out"));
  const target = arg("--target", "google-slides");
  if (target !== "google-slides" && target !== "powerpoint") {
    throw new Error(
      `--target must be google-slides or powerpoint, got ${target}`,
    );
  }
  await mkdir(outDir, { recursive: true });

  const playwright: any = await import(resolvePnpmEntry("playwright", "1.63"));
  const browser = await pick<any>(playwright, "chromium").launch({
    headless: true,
  });
  const page = await (
    await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
    })
  ).newPage();
  page.on("console", (message: any) => {
    if (/export-pptx|pptx/i.test(message.text()))
      console.log(`[page] ${message.text()}`);
  });
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    const button = page
      .locator('button:has-text("Continue as local dev")')
      .first();
    await button.waitFor({ state: "visible", timeout: 120_000 });
    await button.click();
    await page
      .waitForFunction(
        () => !document.body.innerText.includes("Continue as local dev"),
        { timeout: 120_000 },
      )
      .catch(() => {});
    const fixtureIndex = process.argv.indexOf("--fixture");
    if (fixtureIndex >= 0) {
      const { readFile } = await import("node:fs/promises");
      const fixture = JSON.parse(
        await readFile(path.resolve(process.argv[fixtureIndex + 1]), "utf8"),
      );
      const created = await page.evaluate(async (body: unknown) => {
        const res = await fetch("/_agent-native/actions/create-deck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok)
          throw new Error(`create-deck ${res.status}: ${await res.text()}`);
        return res.json();
      }, fixture);
      deckId = created.id;
      console.log(`[google-export] created deck ${deckId}`);
    }
    await page.goto(`${BASE_URL}/deck/${deckId}`, {
      waitUntil: "domcontentloaded",
    });
    const deck = await page.evaluate(async (id: string) => {
      const res = await fetch(
        `/_agent-native/actions/get-deck?id=${encodeURIComponent(id)}&compact=false`,
      );
      if (!res.ok)
        throw new Error(`get-deck ${res.status}: ${await res.text()}`);
      return res.json();
    }, deckId);
    const ids: string[] = deck.slides.map((s: any) => s.id);
    await page.waitForFunction(
      (slideIds: string[]) =>
        slideIds.every((id) =>
          document.querySelector(`[data-slide-canvas="${CSS.escape(id)}"]`),
        ),
      ids,
      { timeout: 180_000 },
    );
    await page.evaluate(() => (document as any).fonts?.ready);
    const result = await page.evaluate(
      async ({ title, slides, aspectRatio, target }: any) => {
        const mod: any = await import("/app/" + "lib/export-pptx-client.ts");
        const { blob, blankShapes } = await mod.buildDeckPptxBlob(
          title,
          slides,
          aspectRatio,
          { target },
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { base64: btoa(binary), blankShapes, byteLength: bytes.length };
      },
      {
        title: deck.title,
        slides: deck.slides.map((s: any) => ({
          id: s.id,
          notes: s.notes ?? undefined,
        })),
        aspectRatio: deck.aspectRatio,
        target,
      },
    );
    const out = path.join(outDir, "deck.pptx");
    await writeFile(out, Buffer.from(result.base64, "base64"));
    console.log(
      `[google-export] ${target} → ${out} (${result.byteLength} bytes, blankShapes=${result.blankShapes})`,
    );
    if (result.blankShapes > 0) {
      console.error(
        `[google-export] FAILED: ${result.blankShapes} shape(s) rasterized empty and are missing from ${out}`,
      );
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("[google-export] FAILED:", error);
  process.exit(1);
});
