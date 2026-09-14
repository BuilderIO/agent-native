/**
 * App-owned bootstrap for the runtimes that mount no Nitro plugins.
 *
 * `agent-native action` and `agent-native agent` both run app actions without
 * the server plugins that register providers, and neither loads the other's
 * entry point: action discovery skips `run.ts` (`SKIP_FILES`), and `runScript`
 * imports only the action it dispatches. So an app that registers a file
 * upload provider — or anything else a plugin would own — has nowhere to put
 * it that both CLI entry points see.
 *
 * `actions/_cli-bootstrap.ts` is that place. Both entry points import it for
 * its side effects before any action runs. The leading underscore keeps action
 * discovery from registering it as an action.
 *
 * The framework's own S3 provider is claimed afterwards, so an app holding the
 * conventional `s3` id with its own configuration rules keeps it.
 */

import fs from "node:fs";
import path from "node:path";

import { ensureS3FileUploadProvider } from "../file-upload/s3.js";
import { importRuntimeSourceModule } from "../server/runtime-source-module.js";

const BOOTSTRAP_DIRS = ["actions", "scripts"];
const BOOTSTRAP_EXTENSIONS = [".ts", ".js", ".mjs"];

/** The app's bootstrap module, or null when it has none. */
export function resolveCliBootstrapFile(cwd = process.cwd()): string | null {
  for (const dir of BOOTSTRAP_DIRS) {
    for (const extension of BOOTSTRAP_EXTENSIONS) {
      const candidate = path.resolve(cwd, dir, `_cli-bootstrap${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Load the app's bootstrap, then claim the file upload slot for the framework
 * provider if the app left it free. A bootstrap that throws fails the CLI run
 * rather than being swallowed: an app that registers storage and silently gets
 * none is the failure this whole path exists to prevent.
 *
 * The import goes through the shared runtime-source loader, not a bare
 * `import()`: the
 * installed CLI runs `dist/` under plain Node, where a `.ts` bootstrap is
 * `ERR_UNKNOWN_FILE_EXTENSION` unless jiti picks it up. `agent-native action`
 * would not have shown this — it runs through `tsx` — but `agent-native agent`
 * does not.
 */
export async function loadCliBootstrap(cwd = process.cwd()): Promise<void> {
  const file = resolveCliBootstrapFile(cwd);
  if (file) {
    await importRuntimeSourceModule(file);
  }
  ensureS3FileUploadProvider();
}
