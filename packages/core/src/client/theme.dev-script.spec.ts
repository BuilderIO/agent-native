/**
 * Pins the shape of the dev-server recovery gate in `theme.ts`.
 *
 * The recovery script is ~9 KB of inline JavaScript that only a Vite dev server
 * can use, and `getThemeInitScript()` is reachable from every app's client root
 * (templates import it in `root.tsx`, and `theme.ts` also exports the module-level
 * `themeInitScript`). A RUNTIME check keeps the string in the bundle: the call has
 * to be inside a branch the bundler can fold away, otherwise every production app
 * downloads a script no user can run — measured on a hosted deployment inside one app's
 * 771 KB root chunk.
 *
 * This is a source-shape check on purpose: a unit test cannot observe bundler
 * dead-code elimination, and the byte-level proof lives where it can be measured
 * (the workspace build's client-graph numbers). What this file can hold is the
 * decision — the gate must be `import.meta.env`-based at the call site.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// source-read-ok: bundler dead-code elimination is not observable from a unit test.
const themeSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "theme.ts"),
  "utf8",
);

/** The statements that decide whether the dev recovery script is appended. */
function recoveryGate(): string {
  // The last occurrence is the call that appends the script; earlier ones may be
  // inside a comment explaining why the gate has to be static.
  const call = themeSource.lastIndexOf("getViteDevRecoveryScript()");
  expect(
    call,
    "theme.ts should still append the dev recovery script",
  ).toBeGreaterThan(-1);
  const start = themeSource.lastIndexOf(
    "export function getThemeInitScript",
    call,
  );
  return themeSource.slice(start, call);
}

describe("getThemeInitScript dev recovery gate", () => {
  it("gates the recovery script on a build-time flag, with optional chaining", () => {
    // Two constraints at once, and each one has been broken in production:
    //  - the flag must be `import.meta.env`-based at the call site, or the bundler
    //    cannot fold it and the ~9 KB script ships to every user;
    //  - it must be OPTIONAL (`import.meta.env?.DEV`), because the Nitro/SSR
    //    bundle has no `import.meta.env` at all and a direct read threw
    //    "Cannot read properties of undefined (reading 'DEV')" on every
    //    server-rendered page (every app answered 500 until it was
    //    corrected).
    expect(recoveryGate()).toMatch(/import\.meta\.env\?\.DEV/);
  });

  it("does not rely on a runtime-only check, which would ship the script", () => {
    const gate = recoveryGate();
    // The old shape returned early on the runtime helper alone, so the string
    // stayed reachable in production bundles.
    expect(gate).not.toMatch(
      /if \(!shouldInlineViteDevRecoveryScript\(\)\) return themeScript;/,
    );
  });
});
