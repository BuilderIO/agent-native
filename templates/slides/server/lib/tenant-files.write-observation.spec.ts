import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_PPTX_EXPORT_TTL_MS,
  pruneHostedPptxExports,
} from "./tenant-files";

const mocks = vi.hoisted(() => ({ noteExternalWrite: vi.fn() }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

// Hosted export pruning deletes files on a timer, so each delete reports
// itself before it unlinks, and a file that is kept reports nothing.
const NOW = Date.parse("2026-11-03T12:00:00Z");
const roots: string[] = [];

beforeEach(() => {
  mocks.noteExternalWrite.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function exportDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "slides-prune-observed-"));
  roots.push(root);
  return root;
}

function writeExport(dir: string, name: string, mtime: Date): void {
  const file = path.join(dir, name);
  fs.writeFileSync(file, "pptx");
  fs.utimesSync(file, mtime, mtime);
}

function callOrder(spy: { mock: { invocationCallOrder: number[] } }): number {
  const order = spy.mock.invocationCallOrder.at(0);
  if (order === undefined) {
    throw new Error("Expected the spy to be called.");
  }
  return order;
}

describe("pruneHostedPptxExports write observation", () => {
  it("notes the delete before unlinking an expired export", () => {
    const dir = exportDir();
    writeExport(
      dir,
      "old.pptx",
      new Date(NOW - HOSTED_PPTX_EXPORT_TTL_MS - 60_000),
    );
    writeExport(dir, "fresh.pptx", new Date(NOW));
    const unlink = vi.spyOn(fs, "unlinkSync");

    pruneHostedPptxExports(dir, NOW);

    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("local-disk");
    expect(callOrder(mocks.noteExternalWrite)).toBeLessThan(callOrder(unlink));
    expect(unlink).toHaveBeenCalledWith(path.join(dir, "old.pptx"));
    expect(unlink).not.toHaveBeenCalledWith(path.join(dir, "fresh.pptx"));
    expect(fs.existsSync(path.join(dir, "old.pptx"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "fresh.pptx"))).toBe(true);
  });

  it("notes nothing when every export is still within its lifetime", () => {
    const dir = exportDir();
    writeExport(dir, "fresh.pptx", new Date(NOW));
    const unlink = vi.spyOn(fs, "unlinkSync");

    pruneHostedPptxExports(dir, NOW);

    expect(mocks.noteExternalWrite).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, "fresh.pptx"))).toBe(true);
  });
});
