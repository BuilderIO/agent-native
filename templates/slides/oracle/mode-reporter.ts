import { appendFileSync, writeFileSync } from "node:fs";

import type { Reporter, TestModule } from "vitest/node";

// Where the reporter writes its records. The ratchet reads the same path.
const MODES_PATH = process.env.ORACLE_MODES_PATH ?? ".tmp/oracle/modes.jsonl";

/**
 * Writes one line per test: its title, its file, and the mode Vitest decided
 * for it at collection. Vitest has already applied skip, todo and file-level
 * focus to that mode, so a "run" or "only" test runs and anything else does not.
 */
export default class ModeReporter implements Reporter {
  onInit() {
    writeFileSync(MODES_PATH, "");
  }

  onTestModuleCollected(module: TestModule) {
    for (const test of module.children.allTests()) {
      appendFileSync(
        MODES_PATH,
        `${JSON.stringify({ file: module.moduleId, title: test.name, mode: test.options.mode })}\n`,
      );
    }
  }
}
