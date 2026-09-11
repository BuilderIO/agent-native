import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index");
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-vscode-e2e-"),
  );
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-vscode-user-"));
  const extensionsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "an-vscode-exts-"),
  );

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        "--disable-workspace-trust",
        "--user-data-dir",
        userDataDir,
        "--extensions-dir",
        extensionsDir,
      ],
    });
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(extensionsDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
