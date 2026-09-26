#!/usr/bin/env node
/**
 * Stage the ffmpeg sidecar that ships inside the app bundle.
 *
 * Why the app ships its own ffmpeg at all: the post-recording audio pass
 * (mic pregain, denoise, loudnorm to -16 LUFS) is the only thing that gives a
 * recording a usable speech level, because ScreenCaptureKit captures with no
 * automatic gain. Before this, `resolve_ffmpeg_path` looked only at
 * `CLIPS_FFMPEG_PATH` and four system paths, so on any Mac without Homebrew's
 * ffmpeg — which is every Mac we hand a DMG to — the pass was skipped and the
 * raw, ~20 dB too quiet mic audio was uploaded. It logged one line and
 * otherwise looked like a working recording.
 *
 * Why it is built here instead of downloaded: the obvious prebuilt binary is
 * the `ffmpeg-static` npm package the template already depends on, but that
 * build is configured `--enable-nonfree`, which is not redistributable, so it
 * cannot go inside a DMG we hand to anyone. The prebuilt macOS arm64 builds
 * that are license-clean come from single-maintainer hosts too slow to sit in
 * a build. Compiling a pinned source tag with a known configure line avoids
 * both problems and produces a far smaller binary than a full build.
 *
 * What it builds: LGPL only. No `--enable-gpl`, so no libx264 — every filter
 * the audio pass needs (volume, afftdn, loudnorm, pan, aformat, volumedetect)
 * is core FFmpeg, and AAC comes from the native encoder. The separate
 * large-file compression path does ask for libx264; without it that path
 * fails its presets and falls through to `/usr/bin/avconvert`, exactly as it
 * does today when ffmpeg is absent altogether. So this strictly improves on
 * the current state and adds no GPL obligation to the app.
 *
 * Escape hatch: set `CLIPS_FFMPEG_SIDECAR=/path/to/ffmpeg` to stage an
 * existing binary instead of compiling (CI cache, a vendored build, a local
 * experiment). It is checked the same way, including the nonfree refusal.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_TAURI = path.resolve(HERE, "..", "src-tauri");
const BIN_DIR = path.join(SRC_TAURI, "binaries");
const CACHE_DIR = path.join(BIN_DIR, ".cache");

/** Pinned so every machine and CI run bundles the identical binary. */
const FFMPEG_TAG = "n7.1.1";
const FFMPEG_TARBALL_SHA256 =
  "f117507dc501f2a6c11f9241d8d0c3213846cfad91764361af37befd6b6c523d";
const FFMPEG_TARBALL_URL = `https://github.com/FFmpeg/FFmpeg/archive/refs/tags/${FFMPEG_TAG}.tar.gz`;

/**
 * Only what the app actually invokes. `--disable-everything` plus this list
 * keeps the binary small and, more usefully, makes an accidental dependency on
 * something we did not intend fail the build instead of bloating the DMG.
 *
 * `--disable-autodetect` stops configure linking whatever happens to be
 * installed on the build machine, which would make the artifact depend on that
 * machine's Homebrew.
 */
const CONFIGURE_ARGS = [
  "--disable-everything",
  "--disable-autodetect",
  "--disable-doc",
  "--disable-debug",
  "--disable-shared",
  "--enable-static",
  "--enable-small",
  "--disable-network",
  "--disable-programs",
  "--enable-ffmpeg",
  // Apple's own codecs: no external libraries, no GPL.
  "--enable-audiotoolbox",
  "--enable-videotoolbox",
  // Containers we read (native mp4/mov, plus webm from browser recordings)
  // and write.
  "--enable-demuxer=mov,matroska,wav,mp3,aac,ogg",
  "--enable-muxer=mp4,mov,null,wav",
  "--enable-decoder=h264,hevc,aac,aac_at,pcm_s16le,pcm_s16be,pcm_f32le,mp3,opus,vorbis,vp8,vp9",
  "--enable-encoder=aac,aac_at,h264_videotoolbox,hevc_videotoolbox,pcm_s16le",
  "--enable-parser=h264,hevc,aac,opus,vp8,vp9,mpegaudio",
  // The audio pass, plus the video filters the compression path uses.
  "--enable-filter=aformat,anull,aresample,volume,volumedetect,loudnorm,afftdn,pan,aselect,atrim,format,scale,fps,null,copy,trim",
  "--enable-protocol=file,pipe",
  "--enable-bsf=extract_extradata",
];

/**
 * Checked on the finished binary. A configure line that silently drops one of
 * these would ship a sidecar that fails at the exact moment it is needed, on a
 * user's machine, with a message nobody reads.
 */
const REQUIRED_FILTERS = [
  "loudnorm",
  "afftdn",
  "volume",
  "volumedetect",
  "pan",
  "aformat",
  "scale",
];
const REQUIRED_ENCODERS = ["aac"];
const REQUIRED_MUXERS = ["mp4"];

function log(message) {
  console.log(`[ffmpeg-sidecar] ${message}`);
}

function fail(message) {
  console.error(`[ffmpeg-sidecar] ${message}`);
  process.exit(1);
}

/** Rust target triple for the binary being staged, which is what Tauri expects
 *  in the filename. Honours an explicit `--target` in the tauri build. */
function targetTriple() {
  const explicit = process.env.CLIPS_FFMPEG_TARGET_TRIPLE?.trim();
  if (explicit) return explicit;
  const fromRustc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (fromRustc.status === 0) {
    const host = fromRustc.stdout
      .split("\n")
      .find((line) => line.startsWith("host:"));
    if (host) return host.slice("host:".length).trim();
  }
  // rustc is a hard requirement of the tauri build itself, so this is only
  // reached in odd environments; guess from the running machine.
  const arch = os.arch() === "arm64" ? "aarch64" : "x86_64";
  return `${arch}-apple-darwin`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const detail = options.quiet
      ? `\n${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-4000)
      : "";
    fail(`${command} ${args.join(" ")} failed (exit ${result.status})${detail}`);
  }
  return result.stdout ?? "";
}

/** `-version`, `-filters` etc. on a candidate binary. Returns null when the
 *  binary will not run at all (wrong arch, missing +x, quarantined). */
function probe(binary, flag) {
  const result = spawnSync(binary, [flag], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * Refuse anything we may not redistribute, and anything missing a piece the
 * app depends on. This runs on both the compiled binary and one supplied via
 * `CLIPS_FFMPEG_SIDECAR`, because the whole point is that the DMG cannot
 * quietly acquire an unshippable or half-capable ffmpeg.
 */
function verifyBinary(binary) {
  const version = probe(binary, "-version");
  if (!version) fail(`${binary} does not run on this machine`);

  if (/--enable-nonfree/.test(version)) {
    fail(
      `${binary} was configured --enable-nonfree, which may not be redistributed. ` +
        `It cannot be bundled in the DMG. (This is what rules out the ffmpeg-static ` +
        `npm binary.) Supply a license-clean build, or let this script compile one.`,
    );
  }

  const filters = probe(binary, "-filters") ?? "";
  const missingFilters = REQUIRED_FILTERS.filter(
    (name) => !new RegExp(`\\s${name}\\s`).test(filters),
  );
  if (missingFilters.length > 0) {
    fail(`${binary} is missing required filters: ${missingFilters.join(", ")}`);
  }

  const encoders = probe(binary, "-encoders") ?? "";
  const missingEncoders = REQUIRED_ENCODERS.filter(
    (name) => !new RegExp(`\\s${name}\\s`).test(encoders),
  );
  if (missingEncoders.length > 0) {
    fail(
      `${binary} is missing required encoders: ${missingEncoders.join(", ")}`,
    );
  }

  const muxers = probe(binary, "-muxers") ?? "";
  const missingMuxers = REQUIRED_MUXERS.filter(
    (name) => !new RegExp(`\\s${name}\\s`).test(muxers),
  );
  if (missingMuxers.length > 0) {
    fail(`${binary} is missing required muxers: ${missingMuxers.join(", ")}`);
  }

  const firstLine = version.split("\n")[0]?.trim();
  log(`verified: ${firstLine}`);
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Cache key covers the tag AND the configure line, so editing the args above
 *  rebuilds instead of reusing a binary built from the old ones. */
function cacheKey() {
  const hash = createHash("sha256")
    .update(FFMPEG_TAG)
    .update(CONFIGURE_ARGS.join(" "))
    .digest("hex")
    .slice(0, 12);
  return `${FFMPEG_TAG}-${hash}`;
}

function buildFromSource(triple) {
  const key = cacheKey();
  const cached = path.join(CACHE_DIR, key, "ffmpeg");
  if (fs.existsSync(cached) && probe(cached, "-version")) {
    log(`using cached build ${key}`);
    return cached;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "clips-ffmpeg-"));
  const tarball = path.join(work, "ffmpeg.tar.gz");
  log(`downloading FFmpeg ${FFMPEG_TAG}`);
  run("curl", ["-sSL", "--fail", "-o", tarball, FFMPEG_TARBALL_URL]);

  const actual = sha256(tarball);
  if (actual !== FFMPEG_TARBALL_SHA256) {
    fail(
      `FFmpeg tarball checksum mismatch.\n  expected ${FFMPEG_TARBALL_SHA256}\n  actual   ${actual}`,
    );
  }

  log("extracting");
  run("tar", ["-xzf", tarball, "-C", work]);
  const srcDir = path.join(work, `FFmpeg-${FFMPEG_TAG}`);
  if (!fs.existsSync(srcDir)) fail(`extracted source not found at ${srcDir}`);

  log(`configuring (LGPL, no libx264) for ${triple}`);
  run("./configure", CONFIGURE_ARGS, { cwd: srcDir, quiet: true });

  log(`building with ${os.cpus().length} jobs — this takes a few minutes`);
  run("make", ["-j", String(os.cpus().length)], { cwd: srcDir, quiet: true });

  const built = path.join(srcDir, "ffmpeg");
  if (!fs.existsSync(built)) fail("build finished but produced no ffmpeg");

  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.copyFileSync(built, cached);
  fs.chmodSync(cached, 0o755);
  fs.rmSync(work, { recursive: true, force: true });
  log(`cached at ${path.relative(SRC_TAURI, cached)}`);
  return cached;
}

function main() {
  if (process.platform !== "darwin") {
    // The Windows/Linux bundles need their own sidecar before they can ship;
    // until then, skip rather than break a non-mac build.
    log(`nothing to do on ${process.platform}`);
    return;
  }

  const triple = targetTriple();
  const destination = path.join(BIN_DIR, `ffmpeg-${triple}`);

  if (fs.existsSync(destination) && probe(destination, "-version")) {
    verifyBinary(destination);
    log(`already staged at ${path.relative(SRC_TAURI, destination)}`);
    return;
  }

  const supplied = process.env.CLIPS_FFMPEG_SIDECAR?.trim();
  const source = supplied ? supplied : buildFromSource(triple);
  if (supplied) log(`staging supplied binary ${supplied}`);
  if (!fs.existsSync(source)) fail(`no ffmpeg at ${source}`);

  verifyBinary(source);

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o755);
  // Ad-hoc sign so the bundled binary is not killed by Gatekeeper on first
  // run. The app's own signing step re-signs the whole bundle afterwards.
  try {
    execFileSync("codesign", ["--force", "--sign", "-", destination], {
      stdio: "pipe",
    });
  } catch (err) {
    log(`codesign of the sidecar failed (non-fatal): ${err.message}`);
  }

  const megabytes = (fs.statSync(destination).size / 1_000_000).toFixed(1);
  log(`staged ${path.relative(SRC_TAURI, destination)} (${megabytes} MB)`);
}

main();
