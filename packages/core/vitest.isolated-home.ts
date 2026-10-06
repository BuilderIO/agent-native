import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * Variables that send a CLI writer somewhere other than the home folder. A
 * developer's shell may set them to real locations, so tests start without them.
 */
const PATH_OVERRIDES = [
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "PLAN_PUBLISH_CONFIG_PATH",
  "AGENT_NATIVE_CODE_AGENTS_HOME",
  "AGENT_NATIVE_REMOTE_DEVICE_PATH",
  "AGENT_NATIVE_SCREEN_MEMORY_DIR",
  "CLIPS_SCREEN_MEMORY_DIR",
];

/**
 * Where Playwright keeps its downloaded browsers when PLAYWRIGHT_BROWSERS_PATH
 * is unset. It is derived from the home folder, so it must be pinned before the
 * home moves or browser-backed specs stop finding the Chromium CI installed.
 */
function playwrightBrowsersPath(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "ms-playwright");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  }
  const cache = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cache, "ms-playwright");
}

/**
 * Gives a test file its own temporary home folder, so nothing under test can
 * write the developer's real `~/.claude.json`, `~/.codex/config.toml`,
 * `~/.cursor/mcp.json`, `~/.agent-native/`, and so on.
 *
 * Specs point `process.env.HOME` at a temporary folder before running the CLI.
 * On macOS and Linux `os.homedir()` follows it, but on Windows it reads
 * `USERPROFILE` and ignores `HOME`, so on Windows those specs wrote the
 * developer's real Codex and Claude Code configs. Here `os.homedir()` follows
 * `HOME` on every platform, and `HOME` starts at a fresh temporary folder, so a
 * spec that sets `HOME` gets that folder and one that does not still gets an
 * isolated one. `APPDATA` and `LOCALAPPDATA` move under it on Windows, and the
 * variables in PATH_OVERRIDES are cleared.
 *
 * This is conventional test isolation, not a sandbox: `os.userInfo()` still
 * reports the real home, and a child process given a hand-built environment
 * without `USERPROFILE` falls back to it.
 *
 * `os.homedir` is replaced rather than spied on: specs call
 * `vi.restoreAllMocks()`, which would undo a spy after their first test.
 * Returns the temporary home and a cleanup that restores everything.
 */
export function isolateUserHome(): { home: string; restore: () => void } {
  const home = mkdtempSync(path.join(os.tmpdir(), "agent-native-home-"));
  const saved = { ...process.env };
  const nativeHomedir = os.homedir;

  // An explicit value, including Playwright's "0" (browsers inside node_modules), is kept.
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= playwrightBrowsersPath(process.env); // guard:allow-env-mutation — Vitest setup, per test file; restored in afterAll
  process.env.HOME = home; // guard:allow-env-mutation — Vitest setup, per test file; restored in afterAll
  process.env.USERPROFILE = home; // guard:allow-env-mutation — Vitest setup, per test file; restored in afterAll
  for (const name of PATH_OVERRIDES) {
    delete process.env[name];
  }
  if (process.platform === "win32") {
    const appData = path.join(home, "AppData", "Roaming");
    const localAppData = path.join(home, "AppData", "Local");
    mkdirSync(appData, { recursive: true });
    mkdirSync(localAppData, { recursive: true });
    process.env.APPDATA = appData; // guard:allow-env-mutation — Vitest setup, per test file; restored in afterAll
    process.env.LOCALAPPDATA = localAppData; // guard:allow-env-mutation — Vitest setup, per test file; restored in afterAll
  }

  os.homedir = () => {
    const current = process.env.HOME || process.env.USERPROFILE;
    if (!current) throw new Error("Tests need HOME set to a temporary folder.");
    return current;
  };
  syncBuiltinESMExports();

  return {
    home,
    restore() {
      os.homedir = nativeHomedir;
      syncBuiltinESMExports();
      for (const name of Object.keys(process.env)) {
        if (!(name in saved)) delete process.env[name];
      }
      Object.assign(process.env, saved);
      rmSync(home, { recursive: true, force: true });
    },
  };
}
