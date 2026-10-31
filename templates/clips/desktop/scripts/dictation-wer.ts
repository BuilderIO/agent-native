#!/usr/bin/env node
/**
 * Word error rate of Clips' dictation engines on your own recordings.
 *
 *   node scripts/dictation-wer.ts <clip-dir> [--engines parakeet,whisper,apple]
 *     [--models <dir>] [--request-permission]
 *
 * <clip-dir> holds audio clips (wav, m4a, mp3, aac, aiff, caf, flac),
 * each with a reference transcript beside it: `standup.m4a` + `standup.txt`.
 * Each clip is converted to the 16 kHz mono audio the app transcribes, then
 * run through each engine the way dictation runs it: Parakeet fed in live
 * blocks after its warm-up, Whisper `base` in 25-second windows, Apple Speech
 * on the whole file with punctuation on. Both sides are lowercased and
 * stripped of punctuation before words are compared.
 *
 * Only numbers are printed: per-clip and overall WER and time per engine.
 * Transcripts and converted audio live in a temporary directory that is
 * deleted on exit, so the clips' words never reach a log or the repo.
 *
 * Models come from the Clips app's models directory (Settings downloads them
 * there), or `--models <dir>` holding `parakeet-unified-en-0.6b-Q8_0.gguf`
 * and `whisper-base-Q8_0.gguf`.
 *
 * Apple Speech runs only when `apple` is in --engines. It needs the Speech
 * Recognition permission for the terminal you run it from; without it the
 * harness stops and says so. `--request-permission` lets it ask, which shows
 * the system prompt once.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_TAURI = path.resolve(HERE, "..", "src-tauri");
// What macOS's afconvert reads.
const AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".m4a",
  ".mp3",
  ".aac",
  ".aiff",
  ".aif",
  ".caf",
  ".flac",
]);
const MODEL_FILES = {
  parakeet: "parakeet-unified-en-0.6b-Q8_0.gguf",
  whisper: "whisper-base-Q8_0.gguf",
} as const;
const ENGINES = ["parakeet", "whisper", "apple"] as const;
type Engine = (typeof ENGINES)[number];

interface Clip {
  name: string;
  audio: string;
  reference: string;
  wav: string;
}

type EngineRun =
  | { ok: true; texts: Map<string, string>; ms: Map<string, number> }
  | { ok: false; reason: string };

function fail(message: string): never {
  console.error(`dictation-wer: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let clipDir: string | undefined;
  let engines: Engine[] = ["parakeet", "whisper"];
  let models = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.clips.tray",
    "models",
  );
  let requestPermission = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--engines") {
      const names = (argv[++index] ?? "").split(",").filter(Boolean);
      const unknown = names.filter(
        (name) => !(ENGINES as readonly string[]).includes(name),
      );
      if (unknown.length || !names.length) {
        fail(`--engines takes a list of ${ENGINES.join(", ")}`);
      }
      engines = names as Engine[];
    } else if (arg === "--models") {
      models = path.resolve(argv[++index] ?? fail("--models needs a path"));
    } else if (arg === "--request-permission") {
      requestPermission = true;
    } else if (arg.startsWith("--")) {
      fail(`unknown option ${arg}`);
    } else if (!clipDir) {
      clipDir = path.resolve(arg);
    } else {
      fail(`unexpected argument ${arg}`);
    }
  }
  if (!clipDir) {
    fail(
      "usage: node scripts/dictation-wer.ts <clip-dir> [--engines parakeet,whisper,apple] [--models <dir>] [--request-permission]",
    );
  }
  return { clipDir, engines, models, requestPermission };
}

function findClips(clipDir: string, scratch: string): Clip[] {
  const entries = fs.readdirSync(clipDir).sort();
  const clips: Clip[] = [];
  for (const entry of entries) {
    const extension = path.extname(entry).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) continue;
    const stem = entry.slice(0, -extension.length);
    const reference = path.join(clipDir, `${stem}.txt`);
    if (!fs.existsSync(reference)) {
      throw new Error(
        `${entry} has no reference transcript ${stem}.txt beside it`,
      );
    }
    clips.push({
      name: entry,
      audio: path.join(clipDir, entry),
      reference: fs.readFileSync(reference, "utf8"),
      wav: path.join(scratch, `${clips.length}.wav`),
    });
  }
  if (!clips.length) throw new Error(`no audio clips in ${clipDir}`);
  return clips;
}

function convert(clips: Clip[]): void {
  for (const clip of clips) {
    const result = spawnSync(
      "afconvert",
      ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", clip.audio, clip.wav],
      { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        `afconvert could not convert ${clip.name}: ${result.stderr.trim()}`,
      );
    }
  }
}

function readResults(
  file: string,
): Array<{ wav: string; text: string | null; ms: number; error?: string }> {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    results?: unknown;
  };
  if (!Array.isArray(parsed.results)) {
    throw new Error(`${file} has no results list`);
  }
  return parsed.results;
}

function toRun(clips: Clip[], file: string): EngineRun {
  const byWav = new Map(
    readResults(file).map((result) => [result.wav, result]),
  );
  const texts = new Map<string, string>();
  const ms = new Map<string, number>();
  for (const clip of clips) {
    const result = byWav.get(clip.wav);
    if (!result) return { ok: false, reason: `no result for ${clip.name}` };
    if (result.error || result.text === null) {
      return {
        ok: false,
        reason: `${clip.name} failed: ${result.error ?? "no text"}`,
      };
    }
    texts.set(clip.name, result.text);
    ms.set(clip.name, result.ms);
  }
  return { ok: true, texts, ms };
}

function runModelEngine(
  engine: "parakeet" | "whisper",
  clips: Clip[],
  models: string,
  scratch: string,
): EngineRun {
  const model = path.join(models, MODEL_FILES[engine]);
  if (!fs.existsSync(model)) {
    return { ok: false, reason: `model not found at ${model}` };
  }
  const manifest = path.join(scratch, `${engine}-manifest.txt`);
  const output = path.join(scratch, `${engine}-results.json`);
  fs.writeFileSync(manifest, clips.map((clip) => clip.wav).join("\n"));
  console.error(`dictation-wer: running ${engine} (first run compiles)…`);
  const result = spawnSync(
    "cargo",
    [
      // The same toolchain `build:alpha` builds the app with.
      "+1.88.0",
      "test",
      "--release",
      "--lib",
      "--manifest-path",
      path.join(SRC_TAURI, "Cargo.toml"),
      "transcribe_engine::tests::transcribes_clips_for_the_wer_harness",
      "--",
      "--ignored",
      "--exact",
    ],
    {
      env: {
        ...process.env,
        CLIPS_WER_ENGINE: engine,
        CLIPS_WER_MODEL: model,
        CLIPS_WER_MANIFEST: manifest,
        CLIPS_WER_OUTPUT: output,
      },
      // The test prints nothing about the clips; cargo's own output is
      // shown only when the run fails.
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0 || !fs.existsSync(output)) {
    console.error(result.stderr.split("\n").slice(-30).join("\n"));
    return { ok: false, reason: `cargo test exited ${result.status}` };
  }
  return toRun(clips, output);
}

function runApple(
  clips: Clip[],
  scratch: string,
  requestPermission: boolean,
): EngineRun {
  const helper = path.join(scratch, "apple-speech");
  const plist = path.join(scratch, "Info.plist");
  fs.writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.clips.dictation-wer</string>
<key>CFBundleName</key><string>Clips dictation WER</string>
<key>NSSpeechRecognitionUsageDescription</key><string>Measures Apple Speech accuracy on your test clips.</string>
</dict></plist>
`,
  );
  const compile = spawnSync(
    "swiftc",
    [
      "-O",
      "-o",
      helper,
      path.join(HERE, "dictation-wer-apple.swift"),
      "-Xlinker",
      "-sectcreate",
      "-Xlinker",
      "__TEXT",
      "-Xlinker",
      "__info_plist",
      "-Xlinker",
      plist,
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
  );
  if (compile.status !== 0) {
    console.error(compile.stderr);
    return { ok: false, reason: "the Apple Speech helper did not compile" };
  }
  const output = path.join(scratch, "apple-results.json");
  console.error("dictation-wer: running apple…");
  const run = spawnSync(
    helper,
    [
      ...(requestPermission ? ["--request-permission"] : []),
      output,
      ...clips.map((clip) => clip.wav),
    ],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
  );
  if (run.status !== 0) {
    return { ok: false, reason: run.stderr.trim() || `exited ${run.status}` };
  }
  return toRun(clips, output);
}

function normalizeWords(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Substitutions, deletions and insertions to turn `hypothesis` into `reference`. */
function wordErrors(reference: string[], hypothesis: string[]): number {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let r = 1; r <= reference.length; r++) {
    const current = [r];
    for (let h = 1; h <= hypothesis.length; h++) {
      current[h] = Math.min(
        previous[h] + 1,
        current[h - 1] + 1,
        previous[h - 1] + (reference[r - 1] === hypothesis[h - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length];
}

function percent(errors: number, words: number): string {
  return words ? `${((errors / words) * 100).toFixed(1)}%` : "n/a";
}

function report(clips: Clip[], runs: Map<Engine, EngineRun>): void {
  const engines = [...runs.keys()];
  const nameWidth = Math.max(7, ...clips.map((clip) => clip.name.length));
  const header = [
    "clip".padEnd(nameWidth),
    "words".padStart(6),
    ...engines.map((engine) => engine.padStart(10)),
  ].join("  ");
  console.log(header);
  const totals = new Map(engines.map((engine) => [engine, 0]));
  let totalWords = 0;
  for (const clip of clips) {
    const reference = normalizeWords(clip.reference);
    totalWords += reference.length;
    const cells = engines.map((engine) => {
      const run = runs.get(engine);
      if (!run?.ok) return "—".padStart(10);
      const errors = wordErrors(
        reference,
        normalizeWords(run.texts.get(clip.name) ?? ""),
      );
      totals.set(engine, (totals.get(engine) ?? 0) + errors);
      return percent(errors, reference.length).padStart(10);
    });
    console.log(
      [
        clip.name.padEnd(nameWidth),
        String(reference.length).padStart(6),
        ...cells,
      ].join("  "),
    );
  }
  console.log(
    [
      "overall".padEnd(nameWidth),
      String(totalWords).padStart(6),
      ...engines.map((engine) =>
        (runs.get(engine)?.ok
          ? percent(totals.get(engine) ?? 0, totalWords)
          : "failed"
        ).padStart(10),
      ),
    ].join("  "),
  );
  console.log(
    [
      "seconds".padEnd(nameWidth),
      "".padStart(6),
      ...engines.map((engine) => {
        const run = runs.get(engine);
        if (!run?.ok) return "—".padStart(10);
        const ms = [...run.ms.values()].reduce((sum, value) => sum + value, 0);
        return (ms / 1000).toFixed(1).padStart(10);
      }),
    ].join("  "),
  );
  for (const [engine, run] of runs) {
    if (!run.ok) console.log(`${engine} failed: ${run.reason}`);
  }
}

function main(): void {
  const { clipDir, engines, models, requestPermission } = parseArgs(
    process.argv.slice(2),
  );
  // Converted audio and transcripts of the clips live only here.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "clips-wer-"));
  const removeScratch = () =>
    fs.rmSync(scratch, { recursive: true, force: true });
  process.once("SIGINT", () => {
    removeScratch();
    process.exit(130);
  });
  let failed = false;
  try {
    const clips = findClips(clipDir, scratch);
    convert(clips);
    const runs = new Map<Engine, EngineRun>();
    for (const engine of engines) {
      runs.set(
        engine,
        engine === "apple"
          ? runApple(clips, scratch, requestPermission)
          : runModelEngine(engine, clips, models, scratch),
      );
    }
    report(clips, runs);
    failed = [...runs.values()].some((run) => !run.ok);
  } catch (error) {
    console.error(`dictation-wer: ${(error as Error).message}`);
    failed = true;
  } finally {
    removeScratch();
  }
  if (failed) process.exit(1);
}

main();
