import { describe, expect, it, vi } from "vitest";

import type { UploadedFile } from "@/components/editor/PromptDialog";

import {
  hydrateReferenceDocuments,
  REFERENCE_HYDRATION_DEADLINE_MS,
  referenceDocumentFormat,
} from "./reference-document-hydration";

function uploaded(name: string, path = `/uploads/${name}`): UploadedFile {
  return {
    path,
    originalName: name,
    filename: name,
    type: "application/octet-stream",
    size: 1024,
  };
}

const pdfResult = {
  format: "pdf",
  pageCount: 2,
  textPageCount: 2,
  pages: [
    { pageNum: 1, text: "Quarterly review" },
    { pageNum: 2, text: "Revenue by segment" },
  ],
  styleDigest: {
    pageCount: 2,
    pageWidthPt: 960,
    pageHeightPt: 540,
    orientation: "landscape",
    aspectRatio: 1.778,
    backgroundColors: [{ color: "#101828", pageCount: 2 }],
    typeScale: [
      {
        fontSizePt: 44,
        fontFamily: "Söhne",
        bold: true,
        color: "#ffffff",
        runCount: 2,
        sample: "Quarterly review",
      },
    ],
    paragraphAlignments: [{ alignment: "left", blockCount: 9 }],
    textMarginsPt: { left: 64, right: 64, top: 48, bottom: 52 },
    pagesWithImages: 1,
  },
};

describe("referenceDocumentFormat", () => {
  it("recognizes the document reference types and nothing else", () => {
    expect(referenceDocumentFormat(uploaded("deck.pdf"))).toBe("pdf");
    expect(referenceDocumentFormat(uploaded("deck.PPTX"))).toBe("pptx");
    expect(referenceDocumentFormat(uploaded("brief.docx"))).toBe("docx");
    expect(referenceDocumentFormat(uploaded("logo.png"))).toBeNull();
    expect(referenceDocumentFormat(uploaded("tokens.fig"))).toBeNull();
  });
});

describe("hydrateReferenceDocuments", () => {
  it("does nothing when no document reference is attached", async () => {
    const callActionImpl = vi.fn();
    await expect(
      hydrateReferenceDocuments([uploaded("logo.png")], { callActionImpl }),
    ).resolves.toEqual({ status: "none" });
    expect(callActionImpl).not.toHaveBeenCalled();
  });

  it("reads a PDF reference and carries its design into the context", async () => {
    const callActionImpl = vi.fn().mockResolvedValue(pdfResult);

    const result = await hydrateReferenceDocuments([uploaded("deck.pdf")], {
      callActionImpl,
    });

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.readCount).toBe(1);
    expect(result.measuredDesignCount).toBe(1);
    expect(result.context).toContain("## Attached Reference Documents");
    expect(result.context).toContain("### deck.pdf (PDF)");
    expect(result.context).toContain("Quarterly review");
    expect(result.context).toContain("960x540pt, landscape");
    expect(result.context).toContain("44pt Söhne bold #ffffff");
    expect(result.context).toContain("64pt left");
    expect(callActionImpl).toHaveBeenCalledWith(
      "import-file",
      expect.objectContaining({
        filePath: "/uploads/deck.pdf",
        format: "pdf",
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(callActionImpl.mock.calls[0]?.[1]).not.toHaveProperty(
      "importIntoDeck",
    );
  });

  it("reports an unmeasurable style digest instead of implying a plain design", async () => {
    const callActionImpl = vi.fn().mockResolvedValue({
      ...pdfResult,
      styleDigest: null,
      styleDigestUnavailableReason: "canvas renderer unavailable",
    });

    const result = await hydrateReferenceDocuments([uploaded("deck.pdf")], {
      callActionImpl,
    });

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context).toContain(
      "Visual style could not be measured from this PDF (canvas renderer unavailable)",
    );
    expect(result.measuredDesignCount).toBe(0);
  });

  it("treats an unavailable upload handle as unreadable, not as an empty reference", async () => {
    const callActionImpl = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Access denied: uploaded file reference is not valid for this user or organization",
        ),
      );

    const result = await hydrateReferenceDocuments([uploaded("deck.pdf")], {
      callActionImpl,
    });

    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") return;
    expect(result.failures).toEqual([
      {
        originalName: "deck.pdf",
        message:
          "Access denied: uploaded file reference is not valid for this user or organization",
      },
    ]);
    expect(result.message).toContain("deck.pdf");
    expect(result.message).toContain("Generation was stopped");
  });

  it("treats a read that returned nothing usable as unreadable", async () => {
    const callActionImpl = vi
      .fn()
      .mockResolvedValue({ format: "pdf", pageCount: 4, textPageCount: 0 });

    const result = await hydrateReferenceDocuments([uploaded("scan.pdf")], {
      callActionImpl,
    });

    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") return;
    expect(result.failures[0].message).toBe(
      "no readable content was found in the file",
    );
  });

  it("reports every unreadable reference, not just the first", async () => {
    const callActionImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("blob 404"))
      .mockRejectedValueOnce(new Error("decrypt failed"));

    const result = await hydrateReferenceDocuments(
      [uploaded("a.pdf"), uploaded("b.pptx")],
      { callActionImpl },
    );

    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") return;
    expect(result.failures.map((failure) => failure.originalName)).toEqual([
      "a.pdf",
      "b.pptx",
    ]);
  });

  it("skips references already imported into a deck", async () => {
    const callActionImpl = vi.fn().mockResolvedValue(pdfResult);

    await expect(
      hydrateReferenceDocuments([uploaded("deck.pdf")], {
        excludePaths: ["/uploads/deck.pdf"],
        callActionImpl,
      }),
    ).resolves.toEqual({ status: "none" });
    expect(callActionImpl).not.toHaveBeenCalled();
  });

  it("carries PPTX theme fonts and slide text", async () => {
    const callActionImpl = vi.fn().mockResolvedValue({
      format: "pptx",
      theme: { fonts: ["Inter", "Inter Tight"], colors: ["#0f172a"] },
      slides: [{ index: 0, texts: "Title slide", layoutHint: "title" }],
    });

    const result = await hydrateReferenceDocuments([uploaded("deck.pptx")], {
      callActionImpl,
    });

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context).toContain("Theme fonts: Inter, Inter Tight");
    expect(result.context).toContain("Slide 0 [title]: Title slide");
  });

  it("carries DOCX sections", async () => {
    const callActionImpl = vi.fn().mockResolvedValue({
      format: "docx",
      sections: [{ heading: "Overview", textPreview: "Why this matters" }],
      textLength: 400,
    });

    const result = await hydrateReferenceDocuments([uploaded("brief.docx")], {
      callActionImpl,
    });

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context).toContain("Overview: Why this matters");
    expect(result.measuredDesignCount).toBe(0);
  });

  it("counts a PPTX theme as a measured design", async () => {
    const callActionImpl = vi.fn().mockResolvedValue({
      format: "pptx",
      theme: { fonts: ["Inter"] },
      slides: [{ index: 0, texts: "Title" }],
    });

    const result = await hydrateReferenceDocuments([uploaded("deck.pptx")], {
      callActionImpl,
    });

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.measuredDesignCount).toBe(1);
  });

  it("reads references concurrently instead of one timeout after another", async () => {
    let inFlight = 0;
    let peak = 0;
    const callActionImpl = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return pdfResult;
    });

    const files = Array.from({ length: 6 }, (_, index) =>
      uploaded(`deck-${index}.pdf`),
    );
    const result = await hydrateReferenceDocuments(files, { callActionImpl });

    expect(result.status).toBe("hydrated");
    expect(callActionImpl).toHaveBeenCalledTimes(6);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("passes a shrinking timeout so the whole step has a deadline", async () => {
    let clock = 0;
    const now = () => clock;
    const callActionImpl = vi.fn().mockImplementation(async () => {
      clock += REFERENCE_HYDRATION_DEADLINE_MS / 2;
      return pdfResult;
    });

    const result = await hydrateReferenceDocuments(
      [uploaded("a.pdf"), uploaded("b.pdf"), uploaded("c.pdf")],
      { callActionImpl, now },
    );

    const timeouts = callActionImpl.mock.calls.map(
      (call) => (call[2] as { timeoutMs: number }).timeoutMs,
    );
    expect(timeouts[0]).toBeLessThanOrEqual(REFERENCE_HYDRATION_DEADLINE_MS);
    expect(Math.min(...timeouts)).toBeLessThan(timeouts[0]);
    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") return;
    expect(result.failures[0].message).toContain("took too long");
  });

  it("keeps the combined reference context within a total budget", async () => {
    const long = "x".repeat(20_000);
    const callActionImpl = vi.fn().mockResolvedValue({
      format: "pdf",
      pageCount: 1,
      textPageCount: 1,
      pages: [{ pageNum: 1, text: long }],
    });

    const files = Array.from({ length: 6 }, (_, index) =>
      uploaded(`deck-${index}.pdf`),
    );
    const result = await hydrateReferenceDocuments(files, { callActionImpl });

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context.length).toBeLessThan(50_000);
    expect(result.context).toContain("filled the reference budget");
  });

  it("does not count a measured design that the budget dropped", async () => {
    const long = "x".repeat(20_000);
    const callActionImpl = vi
      .fn()
      .mockImplementation(
        async (_action: string, input: { filePath: string }) =>
          input.filePath.includes("styled")
            ? pdfResult
            : {
                format: "pdf",
                pageCount: 1,
                textPageCount: 1,
                pages: [{ pageNum: 1, text: long }],
              },
      );

    const result = await hydrateReferenceDocuments(
      [
        uploaded("long-0.pdf"),
        uploaded("long-1.pdf"),
        uploaded("long-2.pdf"),
        uploaded("styled.pdf"),
      ],
      { callActionImpl },
    );

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context).not.toContain("960x540pt, landscape");
    expect(result.measuredDesignCount).toBe(0);
    expect(result.context).toContain("one exception to the no-reread rule");
  });

  it("does not count a measured design the budget only partly kept", async () => {
    const filler = "x".repeat(10_000);
    const callActionImpl = vi
      .fn()
      .mockImplementation(
        async (_action: string, input: { filePath: string }) =>
          input.filePath.includes("styled")
            ? {
                ...pdfResult,
                pages: [{ pageNum: 1, text: "y".repeat(20_000) }],
              }
            : {
                format: "pdf",
                pageCount: 1,
                textPageCount: 1,
                pages: [{ pageNum: 1, text: filler }],
              },
      );

    const result = await hydrateReferenceDocuments(
      [
        uploaded("filler-0.pdf"),
        uploaded("filler-1.pdf"),
        uploaded("filler-2.pdf"),
        uploaded("styled.pdf"),
      ],
      { callActionImpl },
    );

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context).toContain("### styled.pdf (PDF)");
    expect(result.context).toContain("[truncated]");
    expect(result.measuredDesignCount).toBe(0);
  });

  it("names a reference the budget could only fit a fragment of", async () => {
    const filler = "x".repeat(11_800);
    const callActionImpl = vi
      .fn()
      .mockImplementation(
        async (_action: string, input: { filePath: string }) =>
          input.filePath.includes("styled")
            ? pdfResult
            : {
                format: "pdf",
                pageCount: 1,
                textPageCount: 1,
                pages: [{ pageNum: 1, text: filler }],
              },
      );

    const result = await hydrateReferenceDocuments(
      [
        uploaded("filler-0.pdf"),
        uploaded("filler-1.pdf"),
        uploaded("filler-2.pdf"),
        uploaded("styled.pdf"),
      ],
      { callActionImpl },
    );

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context).toContain("### styled.pdf");
    expect(result.context).toContain("filled the reference budget");
    expect(result.measuredDesignCount).toBe(0);
  });

  it("keeps a small reference that still fits the remaining budget", async () => {
    const filler = "x".repeat(11_750);
    const callActionImpl = vi
      .fn()
      .mockImplementation(
        async (_action: string, input: { filePath: string }) =>
          input.filePath.includes("tiny")
            ? {
                format: "docx",
                sections: [{ heading: "Scope", textPreview: "One line" }],
                textLength: 40,
              }
            : {
                format: "pdf",
                pageCount: 1,
                textPageCount: 1,
                pages: [{ pageNum: 1, text: filler }],
              },
      );

    const result = await hydrateReferenceDocuments(
      [
        uploaded("filler-0.pdf"),
        uploaded("filler-1.pdf"),
        uploaded("filler-2.pdf"),
        uploaded("tiny.docx"),
      ],
      { callActionImpl },
    );

    expect(result.status).toBe("hydrated");
    if (result.status !== "hydrated") return;
    expect(result.context).toContain("Scope: One line");
    expect(result.context).not.toContain("### tiny.docx\nRead successfully");
    expect(result.context).not.toContain("[truncated]");
  });
});
