import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  email: vi.fn((): string | undefined => "designer@example.com"),
  open: vi.fn(),
  resolveDesign: vi.fn(async (id?: string) => id ?? "open-design"),
  save: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.email,
}));
vi.mock("../server/lib/figma-reference-attachment.js", () => ({
  openFigmaReference: mocks.open,
}));
vi.mock("../server/lib/import-design-files.js", async (importOriginal) => ({
  normalizeImportedHtmlDocument: (
    await importOriginal<
      typeof import("../server/lib/import-design-files.js")
    >()
  ).normalizeImportedHtmlDocument,
  resolveImportDesignId: mocks.resolveDesign,
  saveImportedDesignFiles: mocks.save,
}));
vi.mock("../server/lib/design-versions.js", () => ({
  snapshotDesignBeforeAgentEdit: mocks.snapshot,
}));

import action from "./place-figma-frames";

const reference = {
  frames: [
    {
      name: "Page 1 / Upload",
      width: 672,
      height: 498,
      html: "<main>A</main>",
    },
    { name: null, html: "<main>B</main>" },
  ],
  frameCount: 2,
  unresolvedImages: 0,
};
const run = (args: Record<string, unknown>) =>
  action.run({ ref: "attachment:v1:abc", ...args } as never, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.email.mockReturnValue("designer@example.com");
  mocks.open.mockResolvedValue(reference);
  mocks.save.mockImplementation(async ({ designId, files }) => ({
    designId,
    files: files.map((file: { filename: string }, index: number) => ({
      id: `file-${index}`,
      filename: file.filename,
    })),
    warnings: [],
  }));
});

describe("place-figma-frames", () => {
  it("saves every attached frame's exact HTML as a screen", async () => {
    const result = await run({ designId: "design-1" });
    expect(mocks.open).toHaveBeenCalledWith(
      "attachment:v1:abc",
      "designer@example.com",
    );
    expect(mocks.snapshot).toHaveBeenCalledWith("design-1", {});
    expect(mocks.save).toHaveBeenCalledWith({
      designId: "design-1",
      sourceType: "figma-reference",
      files: [
        {
          filename: "Page 1 - Upload.html",
          fileType: "html",
          content: expect.stringContaining("<main>A</main>"),
          preferredFrame: { title: "Page 1 / Upload", width: 672, height: 498 },
        },
        {
          filename: "Figma frame 2.html",
          fileType: "html",
          content: expect.stringContaining("<main>B</main>"),
          preferredFrame: { title: "Figma frame 2" },
        },
      ],
    });
    expect(result).toMatchObject({
      placedFrames: 2,
      _receipt: { changed: true, subject: "design-1" },
    });
  });

  it("places only the numbered frames, into the open design by default", async () => {
    await run({ frames: [2] });
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "open-design",
        files: [
          expect.objectContaining({
            content: expect.stringContaining("<main>B</main>"),
          }),
        ],
      }),
    );
  });

  it("strips scripts and event handlers before saving a frame", async () => {
    mocks.open.mockResolvedValue({
      ...reference,
      frames: [
        {
          name: "Pasted",
          html: '<main onclick="steal()"><script>steal()</script><a href="javascript:steal()">x</a></main>',
        },
      ],
    });
    await run({ designId: "design-1" });
    const saved = mocks.save.mock.calls[0]?.[0] as {
      files: Array<{ content: string }>;
    };
    const content = saved.files[0]?.content ?? "";
    expect(content).toContain("<main>");
    expect(content).not.toMatch(/onclick|<script|javascript:/i);
  });

  it("refuses a frame number the attachment lacks, and a signed-out caller", async () => {
    await expect(run({ frames: [3] })).rejects.toThrow(/Frame 3 is not/);
    mocks.email.mockReturnValue(undefined);
    await expect(run({})).rejects.toThrow(/Sign in/);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
