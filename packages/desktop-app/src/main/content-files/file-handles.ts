import { spawnSync } from "node:child_process";
import fs from "node:fs";

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

function lsofReportsOpenHandles(filePath: string): boolean {
  const handles = spawnSync("lsof", ["-t", "--", filePath], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return handles.status === 0 && handles.stdout.trim() !== "";
}

export async function waitForContentFileHandlesToClose(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const isOpenElsewhere =
    platform === "win32" ? windowsFileIsOpenElsewhere : lsofReportsOpenHandles;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (!(await isOpenElsewhere(filePath))) return true;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  return false;
}
