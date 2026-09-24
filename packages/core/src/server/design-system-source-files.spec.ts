import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "../private-blob/index.js";
import { designSystemSourceInputSchema } from "../shared/design-system-authoring.js";
import {
  readDesignSystemSourceFile,
  readDesignSystemSourceUploadBytes,
  storeDesignSystemSourceUpload,
} from "./design-system-source-files.js";
import { readFigmaDesignSystemEvidence } from "./design-system-source-reader.js";
import { runWithRequestContext } from "./request-context.js";

const asOwner = <T>(run: () => T) =>
  runWithRequestContext(
    { userEmail: "owner@example.test", orgId: "org-test" },
    run,
  );
const body = new TextEncoder().encode(
  "# Actual brand\nUse warm orange accents and compact navigation.",
);
const read = vi.fn();
beforeEach(() => {
  vi.stubEnv("SECRETS_ENCRYPTION_KEY", "EXAMPLE_TEST_ONLY_NOT_A_REAL_SECRET");
  read.mockImplementation(async (handle) => ({ handle, data: body }));
  registerPrivateBlobProvider({
    id: "source-test",
    name: "Test private storage",
    isConfigured: () => true,
    async put(input) {
      return {
        id: "opaque-source",
        provider: "source-test",
        opaque: true,
        encrypted: false,
        mimeType: input.mimeType,
        size: input.data.byteLength,
      };
    },
    read,
    async delete() {
      return { provider: "source-test", deleted: false };
    },
  });
});
afterEach(() => {
  unregisterPrivateBlobProvider("source-test");
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("original source upload bytes", () => {
  it.each([
    ["design.md", "text/markdown"],
    ["notes.txt", "text/plain"],
    ["tokens.css", "text/css"],
    ["reference.svg", "image/svg+xml"],
    ["reference.png", "image/png"],
    ["guidelines.pdf", "application/pdf"],
  ])(
    "returns the complete %s source without interpreting or converting it",
    (name, mimeType) =>
      asOwner(async () => {
        const data = mimeType.startsWith("text/")
          ? new TextEncoder().encode(
              `\ufeff  ${"Original source.\r\n".repeat(2000)}  `,
            )
          : Uint8Array.from([0, 255, 128, 1, 13, 10, 254, 0]);
        read.mockImplementation(async (handle) => ({ handle, data }));
        const upload = await storeDesignSystemSourceUpload({ name, data });
        const result = await readDesignSystemSourceUploadBytes({
          id: "original-source",
          kind: "file",
          ...upload,
        });

        expect(result).toEqual({ data, name, mimeType, size: data.byteLength });
        expect(read).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: "source-test",
            id: "opaque-source",
            opaque: true,
            size: data.byteLength,
          }),
        );
      }),
  );

  it.each([
    [undefined, "org-test", "unauthorized", 401],
    ["other@example.test", "org-test", "design_system_upload_forbidden", 403],
    ["owner@example.test", "other-org", "design_system_upload_forbidden", 403],
    ["owner@example.test", undefined, "design_system_upload_forbidden", 403],
  ])(
    "rejects request identity %s / %s before blob access",
    (userEmail, orgId, errorCode, statusCode) =>
      asOwner(async () => {
        const upload = await storeDesignSystemSourceUpload({
          name: "design.md",
          data: body,
        });
        await expect(
          runWithRequestContext({ userEmail, orgId }, () =>
            readDesignSystemSourceUploadBytes({
              id: "source",
              kind: "file",
              ...upload,
            }),
          ),
        ).rejects.toMatchObject({ errorCode, statusCode });
        expect(read).not.toHaveBeenCalled();
      }),
  );

  it.each([
    { name: "different.md" },
    { mimeType: "text/plain" },
    { size: body.byteLength + 1 },
  ])("rejects tampered source metadata %j before blob access", (metadata) =>
    asOwner(async () => {
      const upload = await storeDesignSystemSourceUpload({
        name: "design.md",
        data: body,
      });
      await expect(
        readDesignSystemSourceUploadBytes({
          id: "source",
          kind: "file",
          ...upload,
          ...metadata,
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_upload_invalid",
        statusCode: 400,
      });
      expect(read).not.toHaveBeenCalled();
    }),
  );

  it("rejects arbitrary paths, tampered handles, and Builder receipts before blob access", () =>
    asOwner(async () => {
      const upload = await storeDesignSystemSourceUpload({
        name: "design.md",
        data: body,
      });
      const source = { id: "source", kind: "file" as const, ...upload };
      for (const path of [
        "/etc/passwd",
        "../another-user/design.md",
        "https://example.test/private.md",
        upload.handle.path.slice(0, -8) + "deadbeef",
      ]) {
        await expect(
          readDesignSystemSourceUploadBytes({
            ...source,
            handle: { kind: "stored-file", path },
          }),
        ).rejects.toMatchObject({
          errorCode: "design_system_upload_invalid",
          statusCode: 403,
        });
      }
      await expect(
        readDesignSystemSourceUploadBytes({
          ...source,
          handle: {
            kind: "builder-upload",
            uploadToken: "EXAMPLE_OPAQUE_REFERENCE",
          },
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_upload_unverifiable",
        statusCode: 409,
      });
      expect(read).not.toHaveBeenCalled();
    }));

  it.each([0, body.byteLength - 1, body.byteLength + 1])(
    "rejects corrupt blob length %i without returning partial bytes",
    (size) =>
      asOwner(async () => {
        const upload = await storeDesignSystemSourceUpload({
          name: "design.md",
          data: body,
        });
        read.mockImplementation(async (handle) => ({
          handle,
          data: new Uint8Array(size),
        }));
        await expect(
          readDesignSystemSourceUploadBytes({
            id: "source",
            kind: "file",
            ...upload,
          }),
        ).rejects.toMatchObject({
          errorCode: "design_system_upload_corrupt",
          statusCode: 422,
        });
      }),
  );

  it("propagates private storage errors without an empty or public-read fallback", () =>
    asOwner(async () => {
      const upload = await storeDesignSystemSourceUpload({
        name: "design.md",
        data: body,
      });
      const error = new Error("Example private storage read failure");
      read.mockRejectedValueOnce(error);
      await expect(
        readDesignSystemSourceUploadBytes({
          id: "source",
          kind: "file",
          ...upload,
        }),
      ).rejects.toBe(error);
      expect(read).toHaveBeenCalledTimes(1);
    }));

  it("preserves the original while keeping the existing evidence truncation contract", () =>
    asOwner(async () => {
      const text = `  ${":root { --accent: orange; }\n".repeat(1200)}  `;
      const data = new TextEncoder().encode(text);
      read.mockImplementation(async (handle) => ({ handle, data }));
      const upload = await storeDesignSystemSourceUpload({
        name: "tokens.css",
        data,
      });
      const source = { id: "source", kind: "file" as const, ...upload };
      expect(await readDesignSystemSourceFile(source)).toEqual({
        evidence: text.trim().slice(0, 24000),
        warnings: ["Source text truncated to 24,000 characters."],
        _agentImages: [],
      });
      expect((await readDesignSystemSourceUploadBytes(source)).data).toEqual(
        data,
      );
    }));
});

describe("source evidence and upload ownership", () => {
  it("reads a real signed upload through private storage, not arbitrary paths", () =>
    asOwner(async () => {
      const upload = await storeDesignSystemSourceUpload({
        name: "design.md",
        data: body,
      });
      const source = { id: "source", kind: "file" as const, ...upload };
      expect(designSystemSourceInputSchema.safeParse(source).success).toBe(
        true,
      );
      expect((await readDesignSystemSourceFile(source)).evidence).toContain(
        "warm orange accents",
      );
      expect(read).toHaveBeenCalledTimes(1);
      for (const path of [
        "/etc/passwd",
        "../another-user/design.md",
        "https://example.test/private.md",
      ]) {
        await expect(
          readDesignSystemSourceFile({
            ...source,
            handle: { kind: "stored-file", path },
          }),
        ).rejects.toMatchObject({ statusCode: 403 });
      }
      expect(read).toHaveBeenCalledTimes(1);
    }));

  it("rejects other user/org, tampering and mismatched source metadata before blob access", () =>
    asOwner(async () => {
      const upload = await storeDesignSystemSourceUpload({
        name: "design.md",
        data: body,
      });
      const source = { id: "source", kind: "file" as const, ...upload };
      await expect(
        runWithRequestContext(
          { userEmail: "other@example.test", orgId: "org-test" },
          () => readDesignSystemSourceFile(source),
        ),
      ).rejects.toMatchObject({ errorCode: "design_system_upload_forbidden" });
      await expect(
        runWithRequestContext(
          { userEmail: "owner@example.test", orgId: "other-org" },
          () => readDesignSystemSourceFile(source),
        ),
      ).rejects.toMatchObject({ errorCode: "design_system_upload_forbidden" });
      await expect(
        readDesignSystemSourceFile({
          ...source,
          handle: {
            kind: "stored-file",
            path: upload.handle.path.slice(0, -8) + "deadbeef",
          },
        }),
      ).rejects.toMatchObject({ errorCode: "design_system_upload_invalid" });
      await expect(
        readDesignSystemSourceFile({ ...source, size: source.size + 1 }),
      ).rejects.toMatchObject({ errorCode: "design_system_upload_invalid" });
      expect(read).not.toHaveBeenCalled();
    }));

  it("rejects opaque Builder receipts and unsupported raw Figma uploads honestly", () =>
    asOwner(async () => {
      await expect(
        readDesignSystemSourceFile({
          id: "builder-source",
          kind: "file",
          name: "design.md",
          mimeType: "text/markdown",
          size: 2,
          handle: {
            kind: "builder-upload",
            uploadToken: "EXAMPLE_OPAQUE_REFERENCE",
          },
        }),
      ).rejects.toMatchObject({
        errorCode: "design_system_upload_unverifiable",
        statusCode: 409,
      });
      await expect(
        storeDesignSystemSourceUpload({ name: "file.fig", data: body }),
      ).rejects.toMatchObject({ statusCode: 415 });
      expect(read).not.toHaveBeenCalled();
    }));

  it("extracts actual Figma paints and typography through the existing provider contract", async () => {
    const execute = vi.fn(async () => ({
      response: {
        ok: true,
        json: {
          nodes: {
            "1:2": {
              document: {
                id: "1:2",
                name: "Brand button",
                type: "FRAME",
                fills: [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 } }],
                children: [
                  {
                    id: "1:3",
                    name: "Label",
                    type: "TEXT",
                    characters: "Actual",
                    style: { fontFamily: "Inter", fontSize: 16 },
                  },
                ],
              },
            },
          },
        },
      },
    }));
    const result = await readFigmaDesignSystemEvidence(
      "https://www.figma.com/design/ExampleKey/Brand?node-id=1-2",
      execute,
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "figma",
        path: "/files/ExampleKey/nodes",
        query: { ids: "1:2", depth: "6" },
      }),
    );
    expect(result.evidence).toContain("Inter");
    expect(result.evidence).toContain("fills");
    expect(result.warnings.join(" ")).toContain("Variables");
  });

  it("does not mark inaccessible or empty Figma URLs interpreted", async () => {
    await expect(
      readFigmaDesignSystemEvidence(
        "https://figma.com/design/ExampleKey/Brand",
        async () => ({ response: { ok: false, status: 403 } }),
      ),
    ).rejects.toMatchObject({ errorCode: "design_system_figma_access" });
    await expect(
      readFigmaDesignSystemEvidence(
        "https://figma.com/design/ExampleKey/Brand",
        async () => ({
          response: {
            ok: true,
            json: {
              document: {
                id: "1",
                name: "Empty",
                type: "DOCUMENT",
                children: [],
              },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "design_system_source_empty" });
  });
});
