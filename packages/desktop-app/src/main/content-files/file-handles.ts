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

function readableEntries(directory: string): string[] {
  try {
    return fs.readdirSync(directory);
  } catch {
    // coercion-ok: another user's process, or one that just exited, has no descriptors this user can read
    return [];
  }
}

function descriptorTarget(descriptor: string): string | null {
  try {
    return fs.readlinkSync(descriptor);
  } catch {
    // coercion-ok: a descriptor closed while it was being read no longer holds the file
    return null;
  }
}

function linuxFileIsOpen(filePath: string): boolean {
  const target = fs.realpathSync(filePath);
  for (const pid of readableEntries("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    const descriptors = path.join("/proc", pid, "fd");
    for (const descriptor of readableEntries(descriptors)) {
      if (descriptorTarget(path.join(descriptors, descriptor)) === target) {
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

function openHandleCheck(platform: NodeJS.Platform) {
  if (platform === "win32") return windowsFileIsOpenElsewhere;
  if (platform === "linux") return linuxFileIsOpen;
  return lsofReportsOpenHandles;
}

export async function waitForContentFileHandlesToClose(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const isOpen = openHandleCheck(platform);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (!(await isOpen(filePath))) return true;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  return false;
}

export async function restoreClaimedContentFile(
  claimed: string,
  target: string,
): Promise<boolean> {
  try {
    await fs.promises.link(claimed, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      await fs.promises.rename(claimed, target);
      return true;
    }
    // coercion-ok: a file written to the original path meanwhile wins, and the claimed copy stays beside it
    return false;
  }
  await fs.promises.rm(claimed, { force: true });
  return true;
}
