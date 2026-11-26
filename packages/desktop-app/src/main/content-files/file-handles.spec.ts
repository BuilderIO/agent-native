import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContentFileRestoreError,
  putClaimedContentFileBack,
  restoreClaimedContentFile,
  waitForContentFileHandlesToClose,
} from "./file-handles";

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
  process.platform === "linux" ||
  spawnSync("lsof", ["-v"], { stdio: "ignore" }).error === undefined;

afterEach(() => {
  vi.restoreAllMocks();
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

  it("refuses on macOS when lsof can't run to say who holds the file", async () => {
    const file = temporaryFile();
    const searchPath = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(
        waitForContentFileHandlesToClose(file, "darwin"),
      ).resolves.toBe(false);
    } finally {
      process.env.PATH = searchPath;
    }
  });

  it("refuses on Linux when it can't read the process list", async () => {
    const file = temporaryFile();
    await expect(
      waitForContentFileHandlesToClose(
        file,
        "linux",
        path.join(path.dirname(file), "no-proc"),
      ),
    ).resolves.toBe(false);
  });

  it("refuses when the claimed file is gone before the check can read it", async () => {
    const directory = path.dirname(temporaryFile());
    await expect(
      waitForContentFileHandlesToClose(
        path.join(directory, "gone.md"),
        "linux",
        directory,
      ),
    ).resolves.toBe(false);
  });
});

describe("restoreClaimedContentFile", () => {
  it("puts a claimed file back when its path is still free", async () => {
    const target = temporaryFile();
    const claimed = `${target}.claim`;
    fs.renameSync(target, claimed);

    await expect(restoreClaimedContentFile(claimed, target)).resolves.toBe(
      true,
    );
    expect(fs.readFileSync(target, "utf-8")).toBe("# Note\n");
    expect(fs.existsSync(claimed)).toBe(false);
  });

  it("keeps a file written to the path meanwhile, and the claimed copy beside it", async () => {
    const target = temporaryFile();
    const claimed = `${target}.claim`;
    fs.renameSync(target, claimed);
    fs.writeFileSync(target, "# Written meanwhile\n");

    await expect(restoreClaimedContentFile(claimed, target)).resolves.toBe(
      false,
    );
    expect(fs.readFileSync(target, "utf-8")).toBe("# Written meanwhile\n");
    expect(fs.readFileSync(claimed, "utf-8")).toBe("# Note\n");
  });

  it("moves the same file back without hard links when its path is still free, so a program holding it keeps writing to it", async () => {
    const target = temporaryFile();
    const claimed = `${target}.claim`;
    const { ino } = fs.statSync(target);
    fs.renameSync(target, claimed);
    vi.spyOn(fs.promises, "link").mockRejectedValueOnce(
      Object.assign(new Error("hard links unsupported"), { code: "EPERM" }),
    );

    await expect(restoreClaimedContentFile(claimed, target)).resolves.toBe(
      true,
    );
    expect(fs.statSync(target).ino).toBe(ino);
    expect(fs.readFileSync(target, "utf-8")).toBe("# Note\n");
    expect(fs.existsSync(claimed)).toBe(false);
  });

  it("never replaces a file written meanwhile when hard links fail", async () => {
    const target = temporaryFile();
    const claimed = `${target}.claim`;
    fs.renameSync(target, claimed);
    fs.writeFileSync(target, "# Written meanwhile\n");
    vi.spyOn(fs.promises, "link").mockRejectedValueOnce(
      Object.assign(new Error("hard links unsupported"), { code: "EPERM" }),
    );

    await expect(restoreClaimedContentFile(claimed, target)).resolves.toBe(
      false,
    );
    expect(fs.readFileSync(target, "utf-8")).toBe("# Written meanwhile\n");
    expect(fs.readFileSync(claimed, "utf-8")).toBe("# Note\n");
  });
});

describe("putClaimedContentFileBack", () => {
  it("names nothing once the claimed file is back", async () => {
    const target = temporaryFile();
    const claimed = `${target}.claim`;
    fs.renameSync(target, claimed);

    await expect(
      putClaimedContentFileBack(claimed, target),
    ).resolves.toBeUndefined();
    expect(fs.readFileSync(target, "utf-8")).toBe("# Note\n");
  });

  it("names where the claimed file stays when a file was written meanwhile", async () => {
    const target = temporaryFile();
    const claimed = `${target}.claim`;
    fs.renameSync(target, claimed);
    fs.writeFileSync(target, "# Written meanwhile\n");

    await expect(putClaimedContentFileBack(claimed, target)).resolves.toBe(
      claimed,
    );
    expect(fs.readFileSync(claimed, "utf-8")).toBe("# Note\n");
  });

  it("names where the claimed file stays when it can't be put back", async () => {
    const target = temporaryFile();
    const claimed = `${target}.claim`;
    fs.renameSync(target, claimed);
    vi.spyOn(fs.promises, "link").mockRejectedValueOnce(
      Object.assign(new Error("hard links unsupported"), { code: "EPERM" }),
    );
    vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
      Object.assign(new Error("access denied"), { code: "EACCES" }),
    );

    const failure = await putClaimedContentFileBack(claimed, target).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ContentFileRestoreError);
    expect((failure as ContentFileRestoreError).claimed).toBe(claimed);
    expect((failure as Error).message).toContain(claimed);
    expect(fs.readFileSync(claimed, "utf-8")).toBe("# Note\n");
  });
});
