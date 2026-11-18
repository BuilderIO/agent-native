import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import {
  IMPORT_ZIP_LIMITS,
  ImportZipError,
  newImportZipUsage,
  readImportZip,
} from "./zip";

async function zipOf(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

async function zipError(
  input: Uint8Array,
  limits = IMPORT_ZIP_LIMITS,
): Promise<ImportZipError> {
  const error = await readImportZip(input, limits).catch((caught) => caught);
  expect(error).toBeInstanceOf(ImportZipError);
  return error as ImportZipError;
}

describe("Import zip reader", () => {
  it("reads a zip's files by path and leaves out macOS litter quietly", async () => {
    const { entries, skipped } = await readImportZip(
      await zipOf({
        "Export/Page.md": "# Page",
        "Export/images/logo.png": new Uint8Array([1, 2, 3]),
        "__MACOSX/Export/._Page.md": "litter",
        "Export/.DS_Store": "litter",
      }),
    );

    expect(entries.map((entry) => [entry.path, entry.data.byteLength])).toEqual(
      [
        ["Export/Page.md", 6],
        ["Export/images/logo.png", 3],
      ],
    );
    expect(skipped).toEqual([]);
  });

  it("refuses a path that climbs out or starts at the root, by name", async () => {
    const { entries, skipped } = await readImportZip(
      await zipOf({
        "../escape.md": "# Out",
        "/etc/passwd.md": "# Root",
        "safe/../../away.md": "# Out again",
        "kept.md": "# Kept",
      }),
    );

    expect(entries.map((entry) => entry.path)).toEqual(["kept.md"]);
    expect(skipped).toEqual([
      { name: "../escape.md", reason: "invalid-name" },
      { name: "/etc/passwd.md", reason: "invalid-name" },
      { name: "safe/../../away.md", reason: "invalid-name" },
    ]);
  });

  it("opens the parts of a split export, one level deep", async () => {
    const part = await zipOf({ "Page 1.md": "# One", "Deeper.zip": "x" });
    const { entries, skipped } = await readImportZip(
      await zipOf({
        "Export-Part-1.zip": part,
        "Page 2.md": "# Two",
        "Page 2/attachment.zip": "not opened",
      }),
    );

    expect(entries.map((entry) => entry.path).sort()).toEqual([
      "Page 1.md",
      "Page 2.md",
    ]);
    expect(skipped).toEqual(
      expect.arrayContaining([
        { name: "Deeper.zip", reason: "nested-archive" },
        { name: "Page 2/attachment.zip", reason: "nested-archive" },
      ]),
    );
  });

  it("stops at the file count, the unzipped size, and the zip's own size", async () => {
    const three = await zipOf({ "a.md": "a", "b.md": "b", "c.md": "c" });
    expect(
      (await zipError(three, { ...IMPORT_ZIP_LIMITS, entries: 2 })).code,
    ).toBe("too-many-entries");

    const bomb = await zipOf({ "big.md": "x".repeat(64 * 1024) });
    expect(bomb.byteLength).toBeLessThan(4 * 1024);
    expect(
      (
        await zipError(bomb, {
          ...IMPORT_ZIP_LIMITS,
          uncompressedBytes: 16 * 1024,
        })
      ).code,
    ).toBe("expands-too-large");

    expect(
      (await zipError(three, { ...IMPORT_ZIP_LIMITS, compressedBytes: 10 }))
        .code,
    ).toBe("too-large");
  });

  it("counts the archives inside one, and their size together", async () => {
    const outer = await zipOf({
      "Export-Part-1.zip": await zipOf({ "One.md": "# One" }),
      "Export-Part-2.zip": await zipOf({ "Two.md": "# Two" }),
    });
    expect(
      (await zipError(outer, { ...IMPORT_ZIP_LIMITS, entries: 3 })).code,
    ).toBe("too-many-entries");

    const stored = (name: string) => {
      const part = new JSZip();
      part.file(name, "x".repeat(6 * 1024));
      return part.generateAsync({ type: "uint8array", compression: "STORE" });
    };
    const parts = await zipOf({
      "Export-Part-1.zip": await stored("One.md"),
      "Export-Part-2.zip": await stored("Two.md"),
    });
    expect(parts.byteLength).toBeLessThan(10 * 1024);
    expect(
      (
        await zipError(parts, {
          ...IMPORT_ZIP_LIMITS,
          compressedBytes: 10 * 1024,
        })
      ).code,
    ).toBe("too-large");
  });

  it("shares its limits across the zips picked for one import", async () => {
    const limits = { ...IMPORT_ZIP_LIMITS, entries: 3 };
    const usage = newImportZipUsage();
    await readImportZip(
      await zipOf({ "a.md": "a", "b.md": "b" }),
      limits,
      usage,
    );
    const error = await readImportZip(
      await zipOf({ "c.md": "c", "d.md": "d" }),
      limits,
      usage,
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(ImportZipError);
    expect((error as ImportZipError).code).toBe("too-many-entries");
  });

  it("refuses a listing far past the file limit before parsing it", async () => {
    const litter = await zipOf(
      Object.fromEntries(
        Array.from({ length: 30 }, (_, index) => [
          `__MACOSX/._${index}.md`,
          "",
        ]),
      ),
    );
    const load = vi.spyOn(JSZip, "loadAsync");
    try {
      expect(
        (await zipError(litter, { ...IMPORT_ZIP_LIMITS, entries: 2 })).code,
      ).toBe("too-many-entries");
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  it("names a file that isn't a zip as unreadable", async () => {
    expect((await zipError(new TextEncoder().encode("# Not a zip"))).code).toBe(
      "unreadable",
    );
  });
});
