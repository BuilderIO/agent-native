import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { waitForContentFileHandlesToClose } from "./file-handles";

const directories: string[] = [];

function temporaryFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "content-files-"));
  directories.push(directory);
  const file = path.join(directory, "note.md");
  fs.writeFileSync(file, "# Note\n");
  return file;
}

const canSeeOpenHandles =
  process.platform === "win32" ||
  spawnSync("lsof", ["-v"], { stdio: "ignore" }).error === undefined;

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("waitForContentFileHandlesToClose", () => {
  it("lets a save go ahead on every platform when nothing holds the file", async () => {
    await expect(
      waitForContentFileHandlesToClose(temporaryFile()),
    ).resolves.toBe(true);
  });

  // oracle-change: only Windows or a machine with lsof can see who holds a file open
  it.runIf(canSeeOpenHandles)(
    "refuses while the file is still open",
    async () => {
      const file = temporaryFile();
      const handle = fs.openSync(file, "r+");
      try {
        await expect(waitForContentFileHandlesToClose(file)).resolves.toBe(
          false,
        );
      } finally {
        fs.closeSync(handle);
      }
    },
  );

  // oracle-change: only Windows or a machine with lsof can see who holds a file open
  it.runIf(canSeeOpenHandles)(
    "goes ahead once the file is closed",
    async () => {
      const file = temporaryFile();
      const handle = fs.openSync(file, "r+");
      setTimeout(() => fs.closeSync(handle), 100);
      await expect(waitForContentFileHandlesToClose(file)).resolves.toBe(true);
    },
  );
});
