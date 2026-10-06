import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

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
 * isolated one. The variables the config writers read before `os.homedir()`
 * (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_*`, `APPDATA`) are cleared or moved
 * under the temporary home too.
 *
 * `os.homedir` is replaced rather than spied on: specs call
 * `vi.restoreAllMocks()`, which would undo a spy after their first test.
 * Returns the temporary home and a cleanup that restores everything.
 */
export function isolateUserHome(): { home: string; restore: () => void } {
  const home = mkdtempSync(path.join(os.tmpdir(), "agent-native-home-"));
  const saved = { ...process.env };
  const nativeHomedir = os.homedir;

  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const name of [
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
  ]) {
    delete process.env[name];
  }
  if (process.platform === "win32") {
    process.env.APPDATA = path.join(home, "AppData", "Roaming");
    process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
    mkdirSync(process.env.APPDATA, { recursive: true });
    mkdirSync(process.env.LOCALAPPDATA, { recursive: true });
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
