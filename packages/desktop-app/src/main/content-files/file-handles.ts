import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LIBUV_WINDOWS_OPEN_WITHOUT_SHARING = 0x10000000;
const ATTEMPTS = 20;
const RETRY_MS = 25;

async function windowsFileIsOpenElsewhere(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.promises.open(
      filePath,
      fs.constants.O_RDONLY | LIBUV_WINDOWS_OPEN_WITHOUT_SHARING,
    );
    await handle.close();
    return false;
  } catch {
    // coercion-ok: a file Windows won't open exclusively may still have a writer, so the save waits and then refuses
    return true;
  }
}

async function readableEntries(directory: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(directory);
  } catch {
    // coercion-ok: another user's process, or one that just exited, has no descriptors this user can read
    return [];
  }
}

async function descriptorTarget(descriptor: string): Promise<string | null> {
  try {
    return await fs.promises.readlink(descriptor);
  } catch {
    // coercion-ok: a descriptor closed while it was being read no longer holds the file
    return null;
  }
}

async function linuxFileIsOpen(
  filePath: string,
  procRoot = "/proc",
): Promise<boolean> {
  const target = await fs.promises.realpath(filePath);
  const processes = await fs.promises.readdir(procRoot);
  for (const pid of processes) {
    if (!/^\d+$/.test(pid)) continue;
    const descriptors = path.join(procRoot, pid, "fd");
    for (const descriptor of await readableEntries(descriptors)) {
      if (
        (await descriptorTarget(path.join(descriptors, descriptor))) === target
      ) {
        return true;
      }
    }
  }
  return false;
}

function lsofReportsOpenHandles(filePath: string): boolean {
  const handles = spawnSync("lsof", ["-t", "--", filePath], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (handles.error) return true;
  return handles.status === 0 && handles.stdout.trim() !== "";
}

function openHandleCheck(
  platform: NodeJS.Platform,
  procRoot: string | undefined,
): (filePath: string) => boolean | Promise<boolean> {
  if (platform === "win32") return windowsFileIsOpenElsewhere;
  if (platform === "linux") {
    return (filePath) => linuxFileIsOpen(filePath, procRoot);
  }
  return lsofReportsOpenHandles;
}

async function fileIsHeld(
  isOpen: (filePath: string) => boolean | Promise<boolean>,
  filePath: string,
): Promise<boolean> {
  try {
    return await isOpen(filePath);
  } catch {
    // coercion-ok: a check that can't finish counts as held, so the caller puts the claimed file back
    return true;
  }
}

export async function waitForContentFileHandlesToClose(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
  procRoot?: string,
): Promise<boolean> {
  const isOpen = openHandleCheck(platform, procRoot);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (!(await fileIsHeld(isOpen, filePath))) return true;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  return false;
}

async function pathIsFree(target: string): Promise<boolean> {
  try {
    await fs.promises.lstat(target);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export async function restoreClaimedContentFile(
  claimed: string,
  target: string,
): Promise<boolean> {
  try {
    await fs.promises.link(claimed, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // coercion-ok: a file written to the original path meanwhile wins, and the claimed copy stays beside it
      return false;
    }
    if (!(await pathIsFree(target))) return false;
    await fs.promises.rename(claimed, target);
    return true;
  }
  await fs.promises.rm(claimed, { force: true });
  return true;
}

export async function putClaimedContentFileBack(
  claimed: string,
  target: string,
  saveError?: unknown,
): Promise<string | undefined> {
  try {
    if (await restoreClaimedContentFile(claimed, target)) return undefined;
  } catch (restoreError) {
    throw new ContentFileRestoreError(target, claimed, saveError, restoreError);
  }
  return claimed;
}

export class ContentFileRestoreError extends Error {
  constructor(
    readonly target: string,
    readonly claimed: string,
    readonly saveError: unknown,
    readonly restoreError: unknown,
  ) {
    super(
      `Content couldn't save ${target} or put it back. The original is at ${claimed}.`,
    );
  }
}
