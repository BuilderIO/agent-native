import * as monaco from "monaco-editor";
import { typescript as monacoTypescript } from "monaco-editor";

import "monaco-editor/min/vs/editor/editor.main.css";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

/**
 * Global Monaco environment + language-service wiring, adopted from the old
 * CodeWorkbenchHost. Idempotent: safe to call from every mount site (the
 * workbench root and any lazy-loaded packet component).
 */

let monacoEnvironmentInstalled = false;

export function ensureMonacoEnvironment() {
  if (monacoEnvironmentInstalled || typeof window === "undefined") return;
  (
    globalThis as typeof globalThis & { MonacoEnvironment?: unknown }
  ).MonacoEnvironment = {
    getWorker(_moduleId: string, label: string) {
      if (label === "css" || label === "scss" || label === "less") {
        return new CssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new HtmlWorker();
      }
      if (label === "json") return new JsonWorker();
      if (label === "typescript" || label === "javascript") {
        return new TypeScriptWorker();
      }
      return new EditorWorker();
    },
  };

  // The browser workbench can't resolve module imports the way a real
  // TypeScript project setup would, so semantic diagnostics (unresolved
  // imports, missing types, etc.) produce a wall of bogus red squiggles.
  // Keep syntax checking (real typos, malformed code) but disable semantic
  // validation for both JS and TS. Also allow non-ts extensions (.tsx, .jsx
  // content is common in these buffers regardless of file extension).
  const tsDefaults = monacoTypescript.typescriptDefaults;
  const jsDefaults = monacoTypescript.javascriptDefaults;
  for (const defaults of [tsDefaults, jsDefaults]) {
    defaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    defaults.setCompilerOptions({
      ...defaults.getCompilerOptions(),
      allowNonTsExtensions: true,
    });
  }

  monacoEnvironmentInstalled = true;
}

export { monaco };
