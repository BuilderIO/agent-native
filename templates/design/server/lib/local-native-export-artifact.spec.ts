import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import {
  LocalNativeArtifactError,
  localNativeArtifactPath,
  localNativeArtifactRoot,
  storeLocalNativeExportArtifact,
} from "./local-native-export-artifact.js";

const roots: string[] = [];

async function root() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "native-artifact-test-"));
  roots.push(dir);
  return dir;
}

function png() {
  const bytes = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(2, 16);
  bytes.writeUInt32BE(2, 20);
  return bytes;
}

function jpeg() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xc0, 0, 11, 8, 0, 2, 0, 2, 3, 1, 0x11,
    0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9,
  ]);
}

function webp() {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBPVP8X", 8, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes[24] = 1;
  bytes[27] = 1;
  return bytes;
}

function avif() {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(16, 0);
  bytes.write("ftypavif", 4, "ascii");
  bytes.writeUInt32BE(48, 16);
  bytes.write("meta", 20, "ascii");
  bytes.writeUInt32BE(36, 28);
  bytes.write("iprp", 32, "ascii");
  bytes.writeUInt32BE(28, 36);
  bytes.write("ipco", 40, "ascii");
  bytes.writeUInt32BE(20, 44);
  bytes.write("ispe", 48, "ascii");
  bytes.writeUInt32BE(2, 56);
  bytes.writeUInt32BE(2, 60);
  return bytes;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("local native export artifact", () => {
  it("retains only signed hybrid SVG, PDF and exact native code ZIP bytes", async () => {
    const dir = await root();
    const archive = new JSZip();
    for (const name of [
      "design.html",
      "Design.tsx",
      "design.css",
      "tailwind.css",
      "design-preview.png",
      "README.md",
    ]) {
      archive.file(name, name);
    }
    const cases = [
      [
        "image/svg+xml",
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
        ),
        "svg",
      ],
      [
        "application/pdf",
        Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF\n"),
        "pdf",
      ],
      [
        "application/zip",
        await archive.generateAsync({ type: "nodebuffer" }),
        "zip",
      ],
      [
        "text/html",
        Buffer.from(
          '<!doctype html><html><head><title>Owned native scene</title></head><body><main>Editable native source</main><script type="application/x-agent-native-effects">{}</script><script data-agent-native-native-shader-runtime nonce="test">/* runtime */</script><img data-agent-native-static-fallback src="data:image/png;base64,AAAA" alt="Owned scene"><script nonce="test">/* poster status */</script></body></html>',
        ),
        "html",
      ],
    ] as const;
    for (const [mimeType, bytes, format] of cases) {
      const result = await storeLocalNativeExportArtifact({
        email: "owner@example.test",
        designId: "design-123",
        mimeType,
        bytes,
        root: dir,
      });
      expect(result.format).toBe(format);
      expect(
        await readFile(
          localNativeArtifactPath(
            "owner@example.test",
            "design-123",
            result.artifactId,
            dir,
          )!,
        ),
      ).toEqual(bytes);
    }
    await expect(
      storeLocalNativeExportArtifact({
        email: "owner@example.test",
        designId: "design-123",
        mimeType: "image/svg+xml",
        bytes: Buffer.from('<svg onclick="alert(1)"><rect/></svg>'),
        root: dir,
      }),
    ).rejects.toMatchObject({ code: "invalid-format" });
    await expect(
      storeLocalNativeExportArtifact({
        email: "owner@example.test",
        designId: "design-123",
        mimeType: "text/html",
        bytes: Buffer.from(
          "<!doctype html><html><body>Missing captured poster</body></html>",
        ),
        root: dir,
      }),
    ).rejects.toMatchObject({ code: "invalid-size" });
    await expect(
      storeLocalNativeExportArtifact({
        email: "owner@example.test",
        designId: "design-123",
        mimeType: "application/pdf",
        bytes: Buffer.from("%PDF-1.7\nnot a complete document"),
        root: dir,
      }),
    ).rejects.toMatchObject({ code: "invalid-format" });
    await expect(
      storeLocalNativeExportArtifact({
        email: "owner@example.test",
        designId: "design-123",
        mimeType: "application/zip",
        bytes: Buffer.from("PK\u0003\u0004".repeat(20)),
        root: dir,
      }),
    ).rejects.toMatchObject({ code: "invalid-format" });
  });
  it("retains a hybrid SVG with signed owned image formats and rejects active or remote nested images", async () => {
    const dir = await root();
    const embeddedSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><defs><linearGradient id="sky"><stop stop-color="#f00"/></linearGradient></defs><rect width="8" height="8" fill="url(#sky)"/></svg>';
    const images = [
      ["image/svg+xml", Buffer.from(embeddedSvg)],
      ["image/png", png()],
      ["image/jpeg", jpeg()],
      ["image/webp", webp()],
      ["image/avif", avif()],
    ] as const;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><text>Editable</text>${images
      .map(
        ([mime, bytes], index) =>
          `<image x="${index}" width="1" height="1" href="data:${mime};base64,${bytes.toString("base64")}"/>`,
      )
      .join("")}</svg>`;
    const result = await storeLocalNativeExportArtifact({
      email: "owner@example.test",
      designId: "design-123",
      mimeType: "image/svg+xml",
      bytes: Buffer.from(svg),
      root: dir,
    });
    expect(result.format).toBe("svg");
    expect(
      await readFile(
        localNativeArtifactPath(
          "owner@example.test",
          "design-123",
          result.artifactId,
          dir,
        )!,
      ),
    ).toEqual(Buffer.from(svg));
    for (const nested of [
      "<svg><script>danger()</script></svg>",
      '<?xml-stylesheet href="https://example.test/paint.css"?><svg/>',
      '<svg><image href="https://example.test/image.png"/></svg>',
      '<svg><rect style="fill:url(https://example.test/paint.svg)"/></svg>',
      '<svg><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
    ]) {
      const unsafe = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,${Buffer.from(nested).toString("base64")}"/></svg>`;
      await expect(
        storeLocalNativeExportArtifact({
          email: "owner@example.test",
          designId: "design-123",
          mimeType: "image/svg+xml",
          bytes: Buffer.from(unsafe),
          root: dir,
        }),
      ).rejects.toMatchObject({ code: "invalid-format" });
    }
    await expect(
      storeLocalNativeExportArtifact({
        email: "owner@example.test",
        designId: "design-123",
        mimeType: "image/svg+xml",
        bytes: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/image.png"/></svg>',
        ),
        root: dir,
      }),
    ).rejects.toMatchObject({ code: "invalid-format" });
  });
  it("anchors local storage to the Design app CWD instead of a relocated bundle", () => {
    const appCwd = "/workspace/agent-native/templates/design";
    expect(localNativeArtifactRoot(appCwd)).toBe(
      "/workspace/agent-native/.tmp/shaders-mvp/native-export-artifacts",
    );
    expect(() =>
      localNativeArtifactRoot("/workspace/agent-native/.nitro/dev"),
    ).toThrowError(LocalNativeArtifactError);
  });

  it("stores exact PNG bytes under an owner/design scope and returns bounded metadata", async () => {
    const dir = await root();
    const bytes = png();
    const result = await storeLocalNativeExportArtifact({
      email: "owner@example.test",
      designId: "design-123",
      mimeType: "image/png",
      bytes,
      root: dir,
      now: 100_000,
    });
    const filepath = localNativeArtifactPath(
      "owner@example.test",
      "design-123",
      result.artifactId,
      dir,
    );
    expect(filepath).not.toBeNull();
    expect(await readFile(filepath!)).toEqual(bytes);
    expect(result).toMatchObject({
      format: "png",
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      expiresAt: new Date(100_000 + 3_600_000).toISOString(),
    });
    expect(
      localNativeArtifactPath(
        "other@example.test",
        "design-123",
        result.artifactId,
        dir,
      ),
    ).not.toBe(filepath);
    expect(
      localNativeArtifactPath(
        "owner@example.test",
        "design-123",
        "../../secret.png",
        dir,
      ),
    ).toBeNull();
  });

  it("rejects MIME/signature mismatches and corrupt MP4 boxes without writing", async () => {
    const dir = await root();
    const args = {
      email: "owner@example.test",
      designId: "design-123",
      root: dir,
    };
    await expect(
      storeLocalNativeExportArtifact({
        ...args,
        mimeType: "video/mp4",
        bytes: png(),
      }),
    ).rejects.toMatchObject({ code: "invalid-format" });
    await expect(
      storeLocalNativeExportArtifact({
        ...args,
        mimeType: "image/png",
        bytes: Buffer.from("fake"),
      }),
    ).rejects.toBeInstanceOf(LocalNativeArtifactError);
    const oversizedDimensions = png();
    oversizedDimensions.writeUInt32BE(5_000, 16);
    await expect(
      storeLocalNativeExportArtifact({
        ...args,
        mimeType: "image/png",
        bytes: oversizedDimensions,
      }),
    ).rejects.toMatchObject({ code: "invalid-format" });
  });

  it.each([
    ["jpg", "image/jpeg", jpeg],
    ["webp", "image/webp", webp],
    ["avif", "image/avif", avif],
  ] as const)(
    "stores only signed, sized %s raster bytes",
    async (format, mimeType, makeBytes) => {
      const dir = await root();
      const bytes = makeBytes();
      const result = await storeLocalNativeExportArtifact({
        email: "owner@example.test",
        designId: "design-123",
        mimeType,
        bytes,
        root: dir,
      });
      expect(result.format).toBe(format);
      const filepath = localNativeArtifactPath(
        "owner@example.test",
        "design-123",
        result.artifactId,
        dir,
      );
      expect(await readFile(filepath!)).toEqual(bytes);
      await expect(
        storeLocalNativeExportArtifact({
          email: "owner@example.test",
          designId: "design-123",
          mimeType: "image/png",
          bytes,
          root: dir,
        }),
      ).rejects.toMatchObject({ code: "invalid-format" });
    },
  );

  it("preserves ftyp-signed MP4 bytes under the separate format and size bound", async () => {
    const dir = await root();
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(24, 0);
    bytes.write("ftyp", 4, "ascii");
    bytes.write("isom", 8, "ascii");
    const result = await storeLocalNativeExportArtifact({
      email: "owner@example.test",
      designId: "design-123",
      mimeType: "video/mp4",
      bytes,
      root: dir,
    });
    expect(result.format).toBe("mp4");
    const filepath = localNativeArtifactPath(
      "owner@example.test",
      "design-123",
      result.artifactId,
      dir,
    );
    expect(await readFile(filepath!)).toEqual(bytes);
  });

  it("does not evict live files when the bounded store is full", async () => {
    const dir = await root();
    const args = {
      email: "owner@example.test",
      designId: "design-123",
      mimeType: "image/png",
      bytes: png(),
      root: dir,
      now: 100_000,
    };
    const saved = [];
    for (let index = 0; index < 8; index += 1) {
      saved.push(await storeLocalNativeExportArtifact(args));
    }
    await expect(storeLocalNativeExportArtifact(args)).rejects.toMatchObject({
      code: "storage-capacity",
    });
    const first = localNativeArtifactPath(
      args.email,
      args.designId,
      saved[0]!.artifactId,
      dir,
    );
    expect(await readFile(first!)).toEqual(args.bytes);
  });
});
