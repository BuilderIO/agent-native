import { describe, expect, it } from "vitest";

import { isNetlifyPublicAssetPath } from "./workspace-deploy.js";

// The workspace deploy decides which files from an app's public directory reach
// the static host by extension alone; a file whose extension is not named is
// left out and its URL answers 404 on the deployed app. A notebook runtime hit
// exactly that: its .wasm shipped while the .mjs module beside it, the
// interpreter's .zip and its .whl packages did not, so every Python cell failed
// with "Failed to fetch dynamically imported module".
describe("workspace public asset extensions", () => {
  it("ships the file kinds a notebook runtime needs", () => {
    for (const file of [
      "notebook-runtimes/pyodide/pyodide.mjs",
      "notebook-runtimes/pyodide/pyodide.asm.mjs",
      "notebook-runtimes/pyodide/python_stdlib.zip",
      "notebook-runtimes/pyodide/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
      "notebook-runtimes/pyodide/pyodide-lock.json",
      "notebook-runtimes/duckdb/duckdb-eh.wasm",
      "notebook-runtimes/duckdb/duckdb-browser-eh.worker.js",
    ]) {
      expect(isNetlifyPublicAssetPath(file), file).toBe(true);
    }
  });

  it("still ships the ordinary web assets it always did", () => {
    for (const file of [
      "favicon.ico",
      "icon-192.png",
      "site.webmanifest",
      "robots.txt",
      "manifest.json",
    ]) {
      expect(isNetlifyPublicAssetPath(file), file).toBe(true);
    }
  });

  it("still leaves out file kinds it never shipped", () => {
    for (const file of [
      "notes.exe",
      "secrets.env",
      "backup.tar",
      "script.sh",
      "data.sqlite",
    ]) {
      expect(isNetlifyPublicAssetPath(file), file).toBe(false);
    }
  });
});
