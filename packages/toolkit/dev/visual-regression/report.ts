import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  APPEARANCES,
  type Appearance,
  type Outcome,
  type ShotResult,
} from "./results.ts";

const OUTCOMES: readonly Outcome[] = [
  "matched",
  "recorded",
  "changed",
  "new",
  "unstable",
  "skipped",
];

/** Reads one result the visual setup wrote, refusing anything malformed. */
export function parseResult(json: string, source: string): ShotResult {
  const value = JSON.parse(json) as Partial<ShotResult>;
  if (
    typeof value.storyId !== "string" ||
    typeof value.file !== "string" ||
    !APPEARANCES.includes(value.appearance as Appearance) ||
    !OUTCOMES.includes(value.outcome as Outcome)
  ) {
    throw new Error(`${source} is not a screenshot result: ${json}`);
  }
  return value as ShotResult;
}

export interface VisualSummary {
  /** Stories with at least one result. */
  stories: number;
  /** Stories with at least one screenshot recorded as a new baseline. */
  recordedStories: number;
  counts: Record<Outcome, number>;
  /** Screenshots for review: changed, new and unstable, by story then appearance. */
  review: ShotResult[];
}

export function summarize(results: readonly ShotResult[]): VisualSummary {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<
    Outcome,
    number
  >;
  for (const result of results) counts[result.outcome] += 1;
  const review = results
    .filter((r) => ["changed", "new", "unstable"].includes(r.outcome))
    .sort(
      (a, b) =>
        a.storyId.localeCompare(b.storyId) ||
        APPEARANCES.indexOf(a.appearance) - APPEARANCES.indexOf(b.appearance),
    );
  return {
    stories: new Set(results.map((r) => r.storyId)).size,
    recordedStories: new Set(
      results.filter((r) => r.outcome === "recorded").map((r) => r.storyId),
    ).size,
    counts,
    review,
  };
}

export interface ShotImages {
  before: string | null;
  after: string | null;
  diff: string | null;
}

/**
 * Where Vitest left a screenshot's images, relative to the visual directory.
 * A changed shot keeps the baseline as before and writes the actual and the
 * diff beside it; a new shot is written as a reference, into `diff` when
 * Vitest runs in CI and into `baseline` otherwise.
 */
export function imagesFor(
  result: ShotResult,
  exists: (relative: string) => boolean,
): ShotImages {
  const baseline = `baseline/${result.file}.png`;
  const diff = (suffix: string) => `diff/${result.file}-${suffix}.png`;
  const found = (file: string) => (exists(file) ? file : null);
  switch (result.outcome) {
    case "changed": {
      const after = found(diff("actual"));
      if (!found(baseline) || !after) {
        throw new Error(
          `${result.storyId} (${result.appearance}) changed but ${baseline} or ${diff("actual")} is missing`,
        );
      }
      return { before: baseline, after, diff: found(diff("diff")) };
    }
    case "new": {
      const after = found(diff("reference")) ?? found(baseline);
      if (!after) {
        throw new Error(
          `${result.storyId} (${result.appearance}) is new but no screenshot was written`,
        );
      }
      return { before: null, after, diff: null };
    }
    case "matched":
    case "recorded":
    case "skipped":
    case "unstable":
      return { before: null, after: null, diff: null };
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/gu, "");
}

export function storyUrl(storybookUrl: string, storyId: string): string {
  return `${storybookUrl.replace(/\/$/u, "")}/?path=/story/${encodeURIComponent(storyId)}`;
}

export interface ReviewEntry {
  result: ShotResult;
  /** Paths relative to the report's own directory. */
  images: ShotImages;
}

const LABELS: Record<Outcome, string> = {
  matched: "Matched",
  recorded: "Recorded",
  changed: "Changed",
  new: "New",
  unstable: "Unstable",
  skipped: "Skipped",
};

export function renderHtml(
  summary: VisualSummary,
  entries: readonly ReviewEntry[],
  storybookUrl: string,
): string {
  const image = (label: string, src: string | null) =>
    src
      ? `<figure><figcaption>${label}</figcaption><a href="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="${label}" loading="lazy"></a></figure>`
      : `<figure><figcaption>${label}</figcaption><p class="none">None</p></figure>`;
  const rows = entries
    .map(({ result, images }) => {
      const message = result.message
        ? `<pre>${escapeHtml(stripAnsi(result.message))}</pre>`
        : "";
      return `<section>
  <h2><a href="${escapeHtml(storyUrl(storybookUrl, result.storyId))}">${escapeHtml(result.storyId)}</a> <span>${result.appearance}</span> <span class="tag ${result.outcome}">${LABELS[result.outcome]}</span></h2>
  ${message}
  <div class="images">${image("Before", images.before)}${image("After", images.after)}${image("Diff", images.diff)}</div>
</section>`;
    })
    .join("\n");
  const counts = (["changed", "new", "unstable", "matched", "skipped"] as const)
    .map((o) => `${LABELS[o]} ${summary.counts[o]}`)
    .join(" · ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual changes</title>
<style>
  :root { color-scheme: light dark; font: 14px/1.5 system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 1400px; padding: 24px 16px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 8px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  h2 span { font-weight: normal; opacity: 0.7; }
  section { border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding: 16px 0; }
  .tag { border-radius: 4px; padding: 0 6px; opacity: 1 !important; }
  .changed { background: #f5d90a55; } .new { background: #30a46c44; } .unstable { background: #e5484d44; }
  .images { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  figure { margin: 0; } figcaption { opacity: 0.7; margin-bottom: 4px; }
  img { max-width: 100%; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 0 0 / 16px 16px; }
  pre { white-space: pre-wrap; font-size: 12px; opacity: 0.8; }
  .none { opacity: 0.5; }
</style>
</head>
<body>
<h1>Visual changes</h1>
<p>${summary.stories} stories · ${counts}</p>
${rows || "<p>No visual changes.</p>"}
</body>
</html>
`;
}

export function renderSummary(
  summary: VisualSummary,
  mode: "record" | "compare",
  noBaseline: boolean,
): string {
  const { counts, stories, recordedStories } = summary;
  if (mode === "record") {
    const head = noBaseline
      ? `No baseline on main yet: ${recordedStories} stories recorded, nothing compared.`
      : `Recorded the baseline: ${recordedStories} stories, ${counts.recorded} screenshots.`;
    const unstable =
      counts.unstable > 0
        ? `\n\n${counts.unstable} screenshots never settled and have no baseline:\n\n${summary.review
            .filter((r) => r.outcome === "unstable")
            .map((r) => `- \`${r.storyId}\` (${r.appearance})`)
            .join("\n")}`
        : "";
    return `### Storybook visual regression\n\n${head}${unstable}\n`;
  }
  const lines = [
    "### Storybook visual regression",
    "",
    `${stories} stories compared: ${counts.changed} changed, ${counts.new} new, ${counts.unstable} unstable, ${counts.matched} matched, ${counts.skipped} skipped.`,
  ];
  if (summary.review.length > 0) {
    lines.push(
      "",
      "Visual differences do not fail this check. Review them in the `storybook-visual-changes` artifact.",
      "",
      "| Story | Appearance | Result |",
      "| --- | --- | --- |",
      ...summary.review.map(
        (r) => `| \`${r.storyId}\` | ${r.appearance} | ${LABELS[r.outcome]} |`,
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function readResults(resultsDir: string): ShotResult[] {
  if (!existsSync(resultsDir)) {
    throw new Error(
      `${resultsDir} does not exist: the story tests wrote no screenshot results`,
    );
  }
  const files = readdirSync(resultsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`${resultsDir} holds no screenshot results`);
  }
  return files.map((file) => {
    const source = path.join(resultsDir, file);
    return parseResult(readFileSync(source, "utf8"), source);
  });
}

function main(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: "string" },
      mode: { type: "string" },
      out: { type: "string" },
      "storybook-url": { type: "string", default: ".." },
      "no-baseline": { type: "boolean", default: false },
      summary: { type: "string" },
      output: { type: "string" },
    },
  });
  const { dir, mode, out } = values;
  if (!dir || !out || (mode !== "record" && mode !== "compare")) {
    throw new Error(
      "Usage: report.ts --dir <visual dir> --mode record|compare --out <report dir> [--storybook-url <url>] [--no-baseline] [--summary <file>] [--output <file>]",
    );
  }
  const results = readResults(path.join(dir, "results"));
  const summary = summarize(results);
  const unexpected = results.filter((r) =>
    mode === "record"
      ? !["recorded", "unstable", "skipped"].includes(r.outcome)
      : r.outcome === "recorded",
  );
  const first = unexpected.at(0);
  if (first) {
    throw new Error(
      `${mode} run produced ${first.outcome} for ${first.storyId}`,
    );
  }

  const entries = summary.review.map((result) => {
    const images = imagesFor(result, (file) =>
      existsSync(path.join(dir, file)),
    );
    const copy = (file: string | null, name: string) => {
      if (!file) return null;
      const target = `images/${result.file}-${name}.png`;
      mkdirSync(path.dirname(path.join(out, target)), { recursive: true });
      copyFileSync(path.join(dir, file), path.join(out, target));
      return target;
    };
    return {
      result,
      images: {
        before: copy(images.before, "before"),
        after: copy(images.after, "after"),
        diff: copy(images.diff, "diff"),
      },
    };
  });

  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, "index.html"),
    renderHtml(summary, entries, values["storybook-url"]),
  );
  const markdown = renderSummary(summary, mode, values["no-baseline"]);
  if (values.summary) writeFileSync(values.summary, markdown, { flag: "a" });
  if (values.output) {
    writeFileSync(
      values.output,
      `stories=${summary.stories}\nreview=${summary.review.length}\n`,
      { flag: "a" },
    );
  }
  if (mode === "record" && values["no-baseline"]) {
    console.log(
      `::warning title=No visual baseline::No baseline on main yet: ${summary.recordedStories} stories recorded, nothing compared.`,
    );
  }
  process.stdout.write(markdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
