import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  authorization: vi.fn(),
  original: vi.fn(),
}));
vi.mock("./builder-dsi-access.js", () => ({
  assertBuilderDsiAccess: mocks.access,
}));
vi.mock("./builder-api-auth.js", () => ({
  resolveBuilderRequestAuthorization: mocks.authorization,
  resolveBuilderLegacyRequestAuthorization: vi.fn(),
}));
vi.mock("./design-system-source-files.js", () => ({
  DESIGN_SYSTEM_SOURCE_MAX_BYTES: 20 * 1024 * 1024,
  readDesignSystemSourceUploadBytes: mocks.original,
}));

import { ActionContractError } from "../action.js";
import type { DesignSystemSource } from "../shared/design-system-authoring.js";
import { uploadBuilderDesignSystemSourceFile } from "./builder-design-systems.js";
import { prepareBuilderDesignSystemSources } from "./design-system-builder-sources.js";

const state = {
  excluded: false,
  status: "staged" as const,
  error: null,
  evidence: null,
  provenance: null,
  updatedAt: "2026-09-24T00:00:00.000Z",
};
function file(
  id: string,
  mimeType = "text/plain",
  name = `${id}.txt`,
): DesignSystemSource {
  return {
    ...state,
    id,
    kind: "file",
    name,
    mimeType,
    size: 4,
    handle: {
      kind: "stored-file",
      path: `design-system-upload:v1:<EXAMPLE_${id}>`,
    },
  };
}
function url(id: string, kind: "figma" | "website"): DesignSystemSource {
  return {
    ...state,
    id,
    kind,
    url:
      kind === "figma"
        ? "https://www.figma.com/design/ExampleFile/Example?node-id=1-2"
        : "https://example.com/brand",
  };
}

describe("AN reference-to-Builder upload adapter", () => {
  const fetchMock = vi.fn();
  const readSourceEvidence = vi.fn();
  let failStart: boolean;
  let failSlot: number | undefined;
  let malformedSlots: boolean;
  let transferred: Map<number, Uint8Array>;

  beforeEach(() => {
    vi.resetAllMocks();
    failStart = false;
    failSlot = undefined;
    malformedSlots = false;
    transferred = new Map();
    mocks.access.mockResolvedValue(undefined);
    mocks.authorization.mockResolvedValue({
      source: "oauth",
      authorization: "Bearer <EXAMPLE_OAUTH_TOKEN>",
    });
    mocks.original.mockImplementation(async (source) => ({
      name: source.name,
      mimeType: source.mimeType,
      size: source.size,
      data: new Uint8Array([0, 13, 128, 255]),
    }));
    readSourceEvidence.mockImplementation(async (sourceId) => ({
      sourceId,
      evidence: `Actual scoped reader evidence for ${sourceId}`,
      warnings: ["Reader coverage is bounded."],
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv(
      "BUILDER_DESIGN_SYSTEMS_BASE_URL",
      "https://builder.example.test/design-systems/v1",
    );
    fetchMock.mockImplementation(
      async (input: string | URL, init?: RequestInit) => {
        const requestUrl = String(input);
        if (requestUrl.endsWith("/upload/start")) {
          if (failStart)
            return new Response("<EXAMPLE_SECRET_MUST_NOT_ESCAPE>", {
              status: 500,
            });
          const { attachments } = JSON.parse(String(init?.body));
          return Response.json({
            uploads: malformedSlots
              ? []
              : attachments.map((_: unknown, idx: number) => ({
                  idx,
                  uploadUrl: `https://storage.example.test/start/${idx}`,
                  uploadToken: `<EXAMPLE_UPLOAD_${idx}>`,
                })),
          });
        }
        const index = Number(requestUrl.split("/").at(-1));
        if (requestUrl.includes("storage.example.test/start/"))
          return failSlot === index
            ? new Response("<EXAMPLE_SECRET_MUST_NOT_ESCAPE>", { status: 403 })
            : new Response(null, {
                headers: {
                  Location: requestUrl.replace("/start/", "/session/"),
                },
              });
        if (requestUrl.includes("storage.example.test/session/")) {
          transferred.set(
            index,
            new Uint8Array(await (init!.body as Blob).arrayBuffer()),
          );
          return new Response(null, { status: 200 });
        }
        throw new Error(
          "Unexpected provider request; indexing is forbidden in this adapter test.",
        );
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function prepare(
    sources: DesignSystemSource[],
    intent: "fresh" | "references" = "references",
  ) {
    return prepareBuilderDesignSystemSources({
      sources,
      intent,
      readSourceEvidence,
    });
  }
  function uploadStarts() {
    return fetchMock.mock.calls.filter(([requestUrl]) =>
      String(requestUrl).endsWith("/upload/start"),
    );
  }

  it("sends every PDF/image/text original byte unchanged in one upload job", async () => {
    const sources = [
      file("pdf", "application/pdf", "brand.pdf"),
      file("image", "image/png", "brand.png"),
      file("text"),
    ];
    const originals = [
      new Uint8Array([37, 80, 68, 70, 128, 255]),
      new Uint8Array([137, 80, 78, 71, 0, 255]),
      new TextEncoder().encode("\uFEFFbrand\r\n"),
    ];
    mocks.original.mockImplementation(async (source) => {
      const data =
        originals[sources.findIndex((item) => item.id === source.id)];
      return {
        data,
        name: source.name,
        mimeType: source.mimeType,
        size: data.byteLength,
      };
    });
    const result = await prepare(sources);
    expect(result.status).toBe("ready");
    expect(uploadStarts()).toHaveLength(1);
    expect(result.sources).toHaveLength(3);
    expect([...transferred.values()]).toEqual(originals);
    expect(mocks.original.mock.calls.map(([source]) => source.id)).toEqual([
      "pdf",
      "image",
      "text",
    ]);
    expect(readSourceEvidence).not.toHaveBeenCalled();
    expect(
      result.outcomes.map((item) => [item.status, item.representation]),
    ).toEqual(Array(3).fill(["ready", "original"]));
    expect(
      fetchMock.mock.calls.some(([requestUrl]) =>
        String(requestUrl).includes("/index"),
      ),
    ).toBe(false);
    expect(JSON.stringify(result.outcomes)).not.toContain("EXAMPLE_UPLOAD");
  });

  it("retains mixed files, website and Figma evidence with explicit fidelity limits", async () => {
    const sources = [
      file("brand"),
      url("site", "website"),
      url("frame", "figma"),
    ];
    const result = await prepare(sources);
    expect(result.status).toBe("ready");
    expect(result.sources).toHaveLength(3);
    expect(result.outcomes.map((item) => item.sourceId)).toEqual([
      "brand",
      "site",
      "frame",
    ]);
    expect(readSourceEvidence.mock.calls).toEqual([["site"], ["frame"]]);
    const website = new TextDecoder().decode(transferred.get(1));
    const figma = new TextDecoder().decode(transferred.get(2));
    expect(website).toContain("Source URL: https://example.com/brand");
    expect(website).toContain("Actual scoped reader evidence for site");
    expect(website).toContain("not a complete crawl");
    expect(figma).toContain("node-id=1-2");
    expect(figma).toContain(
      "Variables, off-tree components and complete file fidelity are not extracted",
    );
    expect(figma).toContain("Reader coverage is bounded");
    expect(uploadStarts()).toHaveLength(1);
  });

  it.each([
    [
      "docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  ])(
    "converts %s only through scoped extracted text and keeps limitations",
    async (extension, mimeType) => {
      const result = await prepare([
        file("office", mimeType, `brand.${extension}`),
      ]);
      expect(result.status).toBe("ready");
      expect(mocks.original).not.toHaveBeenCalled();
      expect(readSourceEvidence).toHaveBeenCalledWith("office");
      const text = new TextDecoder().decode(transferred.get(0));
      expect(text).toContain(`brand.${extension}`);
      expect(text).toContain("Original DOCX/PPTX bytes are not uploaded");
      expect(text).toContain("Actual scoped reader evidence for office");
      expect(result.outcomes[0].upload?.mimeType).toBe("text/plain");
      expect(result.outcomes[0].representation).toBe("extracted-text");
    },
  );

  it("preserves JSON bytes under an explicit text upload name", async () => {
    const data = new TextEncoder().encode('{"color":"example"}\r\n');
    mocks.original.mockResolvedValue({
      data,
      name: "tokens.json",
      mimeType: "application/json",
      size: data.byteLength,
    });
    const result = await prepare([
      file("json", "application/json", "tokens.json"),
    ]);
    expect(transferred.get(0)).toEqual(data);
    expect(result.outcomes[0].upload).toMatchObject({
      name: "1-tokens.json.txt",
      mimeType: "text/plain",
    });
    expect(result.outcomes[0].warnings[0]).toContain("original bytes");
  });

  it("fresh creates no fabricated guidance or provider upload", async () => {
    await expect(prepare([], "fresh")).resolves.toEqual({
      status: "ready",
      sources: [],
      outcomes: [],
    });
    expect(mocks.access).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readSourceEvidence).not.toHaveBeenCalled();
  });

  it("does not silently drop references from a fresh request", async () => {
    await expect(prepare([file("keep")], "fresh")).rejects.toMatchObject({
      errorCode: "design_system_builder_fresh_has_sources",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies personal access before originals, readers or provider credentials", async () => {
    mocks.access.mockRejectedValue(
      new ActionContractError("Connect Builder", {
        errorCode: "builder_dsi_missing",
        statusCode: 403,
      }),
    );
    await expect(
      prepare([file("file"), url("site", "website")]),
    ).rejects.toMatchObject({ errorCode: "builder_dsi_missing" });
    expect(mocks.original).not.toHaveBeenCalled();
    expect(readSourceEvidence).not.toHaveBeenCalled();
    expect(mocks.authorization).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      uploadBuilderDesignSystemSourceFile(
        {
          idx: 0,
          uploadUrl: "https://storage.example.test/start/0",
          uploadToken: "<EXAMPLE_UPLOAD>",
        },
        { name: "brand.txt", data: new Uint8Array([1]) },
      ),
    ).rejects.toMatchObject({ errorCode: "builder_dsi_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["reader-error", "empty", "mismatch"])(
    "keeps every source and blocks uploads on %s",
    async (kind) => {
      readSourceEvidence.mockImplementation(async (sourceId) => {
        if (kind === "reader-error")
          throw new ActionContractError("secret-containing upstream message", {
            errorCode: "design_system_figma_access",
            statusCode: 403,
          });
        return {
          sourceId: kind === "mismatch" ? "wrong-source" : sourceId,
          evidence: "",
          warnings: [],
        };
      });
      const result = await prepare([file("good"), url("failed", "figma")]);
      expect(result.status).toBe("needs-attention");
      expect(result.sources).toBeNull();
      expect(result.outcomes).toHaveLength(2);
      expect(result.outcomes[0].status).toBe("staged");
      expect(result.outcomes[1].status).toBe("needs-attention");
      expect(JSON.stringify(result)).not.toContain("secret-containing");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("keeps owner-bound original read failures as needs-attention", async () => {
    mocks.original.mockRejectedValue(
      new ActionContractError("Wrong owner", {
        errorCode: "design_system_upload_forbidden",
        statusCode: 403,
      }),
    );
    const result = await prepare([file("private")]);
    expect(result.status).toBe("needs-attention");
    expect(result.outcomes[0].error?.code).toBe(
      "design_system_upload_forbidden",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails unsupported bytes explicitly without omitting the source", async () => {
    const result = await prepare([
      file("archive", "application/zip", "code.zip"),
      file("good"),
    ]);
    expect(result.status).toBe("needs-attention");
    expect(result.sources).toBeNull();
    expect(result.outcomes[0].error?.code).toBe(
      "design_system_builder_source_unsupported",
    );
    expect(result.outcomes).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "refuses unverifiable existing signed uploads (mixed=%s)",
    async (mixed) => {
      const signed = {
        ...file("signed"),
        handle: {
          kind: "builder-upload" as const,
          uploadToken: "<EXAMPLE_EXISTING_UPLOAD>",
        },
      };
      const result = await prepare(mixed ? [signed, file("new")] : [signed]);
      expect(result.status).toBe("needs-attention");
      expect(result.outcomes[0].error?.code).toBe(
        "design_system_builder_upload_unverifiable",
      );
      expect(JSON.stringify(result)).not.toContain("EXAMPLE_EXISTING_UPLOAD");
      expect(mocks.original).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("preserves successful siblings but never exposes a partial index payload", async () => {
    failSlot = 1;
    const result = await prepare([file("one"), file("two"), file("three")]);
    expect(result.status).toBe("needs-attention");
    expect(result.sources).toBeNull();
    expect(result.outcomes.map((item) => item.status)).toEqual([
      "ready",
      "needs-attention",
      "ready",
    ]);
    expect(transferred.size).toBe(2);
    expect(uploadStarts()).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("EXAMPLE_SECRET");
    expect(JSON.stringify(result)).not.toContain("EXAMPLE_UPLOAD");
  });

  it.each(["failure", "missing-slots"])(
    "treats upload start %s as batch failure",
    async (kind) => {
      failStart = kind === "failure";
      malformedSlots = kind === "missing-slots";
      const result = await prepare([file("one"), file("two")]);
      expect(result.status).toBe("needs-attention");
      expect(
        result.outcomes.every((item) => item.status === "needs-attention"),
      ).toBe(true);
      expect(transferred.size).toBe(0);
      expect(uploadStarts()).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("EXAMPLE_SECRET");
    },
  );

  it("retains explicitly excluded outcomes without uploading or reading them", async () => {
    const result = await prepare([
      { ...file("excluded"), excluded: true },
      file("active"),
    ]);
    expect(result.status).toBe("ready");
    expect(result.sources).toHaveLength(1);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]).toMatchObject({
      excluded: true,
      status: "staged",
      upload: null,
    });
    expect(mocks.original).toHaveBeenCalledOnce();
  });

  it("bounds evidence with an explicit truncation warning", async () => {
    readSourceEvidence.mockResolvedValue({
      sourceId: "site",
      evidence: "x".repeat(24001),
      warnings: [],
    });
    const result = await prepare([url("site", "website")]);
    expect(result.outcomes[0].warnings).toContain(
      "Evidence excerpt limited to 24,000 characters.",
    );
    expect(new TextDecoder().decode(transferred.get(0))).not.toContain(
      "x".repeat(24001),
    );
  });

  it("rejects empty reference batches and duplicate source identities", async () => {
    await expect(prepare([])).rejects.toMatchObject({
      errorCode: "design_system_builder_sources_empty",
    });
    await expect(prepare([file("same"), file("same")])).rejects.toMatchObject({
      errorCode: "design_system_builder_sources_invalid",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds the batch before reading large originals", async () => {
    const result = await prepare(
      Array.from({ length: 6 }, (_, index) => ({
        ...file(`file${index}`),
        size: 20 * 1024 * 1024,
      })),
    );
    expect(result.status).toBe("needs-attention");
    expect(result.outcomes).toHaveLength(6);
    expect(
      result.outcomes.every(
        (item) => item.error?.code === "design_system_builder_batch_size",
      ),
    ).toBe(true);
    expect(mocks.original).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
