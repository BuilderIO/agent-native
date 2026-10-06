/**
 * Contract: every attachment kind the composer can produce is minted once into
 * a core attachment ref and opened by the one shared reader, whichever path
 * minted it (chat composer hook, upload route, chunked commit) and whichever
 * Slides action accepts the file. No action opens storage on its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  ATTACHMENT_REF_PREFIX,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", async () => ({
  getRequestOrgId: (await import("@agent-native/core/server/request-context"))
    .getRequestOrgId,
  getRequestRunContext: () => undefined,
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(),
}));
vi.mock("@agent-native/core/ingestion", () => ({
  readBoundedResponseBytes: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({ resolveAccess: vi.fn() }));
vi.mock("../server/handlers/assets.js", () => ({
  canSaveAsUploadedAsset: () => false,
  hasExpectedSvgSignature: () => true,
  isSafeSvg: () => true,
  uploadImageAsset: vi.fn(),
}));
vi.mock("../server/handlers/request-auth-context.js", () => ({
  resolveSlidesRequestAuth: vi.fn(),
  withSlidesRequestContext: vi.fn(),
}));

import { saveUploadedReferenceFile } from "../server/handlers/uploads";
import { prepareSlidesChatAttachments } from "../server/lib/chat-attachments";
import { readUserUploadedFile } from "./_uploaded-files";

const OWNER = "owner@example.com";
const ORG = "org-one";
const originalEnv = {
  key: process.env.SECRETS_ENCRYPTION_KEY,
  netlify: process.env.NETLIFY,
};

const blobs = new Map<string, Uint8Array>();
const provider: PrivateBlobProvider = {
  id: "memory",
  name: "Memory",
  isConfigured: () => true,
  put: async (input) => {
    const id = `memory:${blobs.size + 1}`;
    blobs.set(id, new Uint8Array(input.data));
    return { id, provider: "memory", opaque: true, encrypted: false };
  },
  read: async (handle: PrivateBlobHandle) => ({
    data: blobs.get(handle.id) ?? new Uint8Array(),
    handle,
  }),
  delete: async (handle: PrivateBlobHandle) => ({
    deleted: blobs.delete(handle.id),
    provider: "memory",
  }),
};

beforeEach(() => {
  blobs.clear();
  process.env.SECRETS_ENCRYPTION_KEY = "slides-contract-test";
  process.env.NETLIFY = "true";
  registerPrivateBlobProvider(provider);
});

afterEach(() => {
  unregisterPrivateBlobProvider("memory");
  for (const [name, value] of [
    ["SECRETS_ENCRYPTION_KEY", originalEnv.key],
    ["NETLIFY", originalEnv.netlify],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const inOrg = async <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER, orgId: ORG }, fn);

const dataUrl = (mime: string, bytes: Buffer) =>
  `data:${mime};base64,${bytes.toString("base64")}`;

const KINDS = [
  {
    kind: "pdf",
    attachmentType: "file",
    name: "Quarterly report.pdf",
    mime: "application/pdf",
    bytes: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4096, 7)]),
  },
  {
    kind: "image",
    attachmentType: "image",
    name: "logo.png",
    mime: "image/png",
    bytes: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2048, 3),
    ]),
  },
  {
    kind: "text/markdown",
    attachmentType: "file",
    name: "brief.md",
    mime: "text/markdown",
    bytes: Buffer.from("# Brief\n\nShip the deck.\n"),
  },
  {
    kind: "large file",
    attachmentType: "file",
    name: "huge-deck.pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(5 * 1024 * 1024, 9),
    ]),
  },
] as const;

describe.each(KINDS)("$kind attachment", (entry) => {
  it("minted by the chat composer hook opens through the shared reader", async () => {
    const attachment = {
      type: entry.attachmentType,
      name: entry.name,
      contentType: entry.mime,
      data: dataUrl(entry.mime, entry.bytes),
    };

    const prepared = await inOrg(() =>
      prepareSlidesChatAttachments({
        ownerEmail: OWNER,
        message: "use this",
        attachments: [attachment],
      }),
    );
    const stamped = prepared?.attachments?.[0] as
      | { slidesUploadPath?: string }
      | undefined;

    expect(stamped?.slidesUploadPath?.startsWith(ATTACHMENT_REF_PREFIX)).toBe(
      true,
    );
    const file = await inOrg(() =>
      readUserUploadedFile(stamped!.slidesUploadPath!),
    );
    expect(Buffer.compare(file.data, entry.bytes)).toBe(0);
    expect(path.extname(file.filename)).toBe(path.extname(entry.name));

    // The model may name the attachment instead of copying the reference.
    const byName = await inOrg(() =>
      readUserUploadedFile(entry.name, { attachments: prepared!.attachments }),
    );
    expect(Buffer.compare(byName.data, entry.bytes)).toBe(0);
  });

  it("minted by the upload route and chunked commit opens through the same reader", async () => {
    const saved = await inOrg(() =>
      saveUploadedReferenceFile({
        email: OWNER,
        orgId: ORG,
        originalName: entry.name,
        data: entry.bytes,
        type: entry.mime,
      }),
    );

    expect(saved.path.startsWith(ATTACHMENT_REF_PREFIX)).toBe(true);
    const file = await inOrg(() => readUserUploadedFile(saved.path));
    expect(Buffer.compare(file.data, entry.bytes)).toBe(0);
  });
});

describe("one reader for every Slides action that accepts a file", () => {
  const actionsDir = __dirname;
  const sources = (dir: string): Array<{ file: string; source: string }> =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
        ? [
            {
              file: path.relative(actionsDir, full),
              source: readFileSync(full, "utf8"),
            },
          ]
        : [];
    });
  const serverDir = path.join(actionsDir, "..", "server");
  const all = [...sources(actionsDir), ...sources(serverDir)];

  it("routes import-file, import-pptx and import-docx through readUserUploadedFile with the run context", () => {
    const readers = sources(actionsDir)
      .filter(({ source }) => source.includes("readUserUploadedFile("))
      .map(({ file }) => file)
      .filter((file) => file !== "_uploaded-files.ts")
      .sort();

    expect(readers).toEqual([
      "import-docx.ts",
      "import-file.ts",
      "import-pptx.ts",
    ]);
    for (const file of readers) {
      const source = readFileSync(path.join(actionsDir, file), "utf8");
      expect(source).toMatch(/readUserUploadedFile\(filePath, ctx\)/);
    }
  });

  it("keeps descriptors, storage reads and message matching out of templates", () => {
    const allowed = new Set([
      "_uploaded-files.ts",
      path.join("..", "server", "lib", "uploaded-reference-storage.ts"),
    ]);
    const offenders = (pattern: RegExp, skip = new Set<string>()) =>
      all
        .filter(({ file, source }) => !skip.has(file) && pattern.test(source))
        .map(({ file }) => file);

    // The legacy prefix is the core resolver's to accept, never Slides' to name.
    expect(offenders(/slides-upload:/)).toEqual([]);
    expect(
      offenders(
        /message\s*===\s*["'`](?:Invalid uploaded file reference|Access denied)/,
      ),
    ).toEqual([]);
    expect(
      offenders(/resolveUploadedReference|readUploadedReferenceBlob/, allowed),
    ).toEqual([]);
    // The file-accepting actions never open storage themselves.
    expect(
      sources(actionsDir)
        .filter(({ file }) => /^import-(?:file|pptx|docx)\.ts$/.test(file))
        .filter(({ source }) => /readPrivateBlob\(/.test(source))
        .map(({ file }) => file),
    ).toEqual([]);
  });
});
