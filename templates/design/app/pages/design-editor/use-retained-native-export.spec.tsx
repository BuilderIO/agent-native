// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const localEvidence = vi.hoisted(() => ({
  enabled: vi.fn<(blob: Blob) => boolean>(),
  save: vi.fn(),
}));

vi.mock("./native-scene-export-client", () => ({
  nativeExportLocalQaSinkEnabled: localEvidence.enabled,
}));
vi.mock("@/lib/local-native-export-artifact", () => ({
  LocalNativeExportArtifactError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  saveLocalNativeExportArtifact: localEvidence.save,
}));

import { RetainedNativeExportLink } from "./RetainedNativeExportLink";
import { useRetainedNativeExport } from "./use-retained-native-export";

afterEach(() => {
  vi.restoreAllMocks();
  localEvidence.enabled.mockReset();
  localEvidence.save.mockReset();
  document.body.replaceChildren();
});

describe("retained native export download", () => {
  it("starts the download, exposes a repeatable link, and revokes only after replacement or unmount", async () => {
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicks.push(`${this.getAttribute("href")}:${this.download}`);
      },
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let download: ReturnType<typeof useRetainedNativeExport>["download"];
    function Harness({ ownerId }: { ownerId: string }) {
      const retained = useRetainedNativeExport(ownerId);
      download = retained.download;
      return retained.result ? (
        <RetainedNativeExportLink
          result={retained.result}
          label="Download again"
        />
      ) : null;
    }

    await act(async () => root.render(<Harness ownerId="design-1" />));
    const png = new Blob(["png"], { type: "image/png" });
    await act(async () => download!(png, "first.png", "png"));
    const link = container.querySelector<HTMLAnchorElement>("a")!;
    expect(createUrl).toHaveBeenCalledWith(png);
    expect(link.getAttribute("href")).toBe("blob:first");
    expect(link.download).toBe("first.png");
    expect(link.hasAttribute("data-native-export-download-result")).toBe(true);
    expect(link.textContent).toContain("Download again");
    expect(link.textContent).toContain("first.png");
    expect(clicks).toEqual(["blob:first:first.png"]);
    expect(revokeUrl).not.toHaveBeenCalled();
    link.click();
    expect(clicks).toEqual(["blob:first:first.png", "blob:first:first.png"]);

    await act(async () =>
      download!(new Blob(["mp4"], { type: "video/mp4" }), "second.mp4", "mp4"),
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "blob:second",
    );
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:first");
    await act(async () => root.render(<Harness ownerId="design-2" />));
    expect(container.querySelector("a")).toBeNull();
    expect(revokeUrl).toHaveBeenCalledWith("blob:second");
    await act(async () => root.unmount());
  });

  it("keeps the previous retry link if starting a replacement download fails", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:ready")
      .mockReturnValueOnce("blob:failed");
    const revokeUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    click.mockImplementationOnce(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let download: ReturnType<typeof useRetainedNativeExport>["download"];
    function Harness() {
      const retained = useRetainedNativeExport("design-1");
      download = retained.download;
      return retained.result ? (
        <RetainedNativeExportLink result={retained.result} label="Retry" />
      ) : null;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => download!(new Blob(["a"]), "ready.png", "png"));
    click.mockImplementationOnce(() => {
      throw new Error("download blocked");
    });
    await expect(
      act(async () => download!(new Blob(["b"]), "failed.mp4", "mp4")),
    ).rejects.toThrow("download blocked");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "blob:ready",
    );
    expect(revokeUrl).toHaveBeenCalledWith("blob:failed");
    expect(revokeUrl).not.toHaveBeenCalledWith("blob:ready");
    await act(async () => root.unmount());
    expect(revokeUrl).toHaveBeenCalledWith("blob:ready");
  });

  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["webp", "image/webp"],
    ["avif", "image/avif"],
  ] as const)(
    "retains exact %s Blob and local evidence separately from download",
    async (format, mimeType) => {
      localEvidence.enabled.mockReturnValue(true);
      let finishSave!: (value: {
        artifactId: string;
        format: typeof format;
        byteLength: number;
        sha256: string;
        expiresAt: string;
      }) => void;
      localEvidence.save.mockReturnValue(
        new Promise((resolve) => {
          finishSave = resolve;
        }),
      );
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:exact");
      const revoke = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => {});
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      let download!: ReturnType<typeof useRetainedNativeExport>["download"];
      function Harness() {
        const retained = useRetainedNativeExport("design-1");
        download = retained.download;
        return retained.result ? (
          <RetainedNativeExportLink result={retained.result} label="Retry" />
        ) : null;
      }
      await act(async () => root.render(<Harness />));
      const blob = new Blob([`exact-${format}`], { type: mimeType });
      await act(async () => download(blob, `exact.${format}`, format));
      expect(click).toHaveBeenCalledOnce();
      expect(localEvidence.save).toHaveBeenCalledWith({
        designId: "design-1",
        blob,
        signal: expect.any(AbortSignal),
      });
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "blob:exact",
      );
      expect(
        container.querySelector("a")?.dataset.nativeExportLocalEvidence,
      ).toBe("pending");
      await act(async () =>
        finishSave({
          artifactId: `12345678-1234-1234-1234-123456789abc.${format}`,
          format,
          byteLength: blob.size,
          sha256: "a".repeat(64),
          expiresAt: new Date().toISOString(),
        }),
      );
      expect(
        container.querySelector("a")?.dataset.nativeExportLocalEvidence,
      ).toBe("saved");
      expect(
        container.querySelector("a")?.dataset.nativeExportLocalArtifactId,
      ).toBe(`12345678-1234-1234-1234-123456789abc.${format}`);
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "blob:exact",
      );
      expect(revoke).not.toHaveBeenCalled();
      await act(async () => root.unmount());
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:exact");
    },
  );

  it("keeps download recovery when the optional local handoff fails, and skips unadvertised Blobs", async () => {
    localEvidence.enabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
    localEvidence.save.mockRejectedValue(new Error("disk unavailable"));
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:legacy")
      .mockReturnValueOnce("blob:native");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const onError = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let download!: ReturnType<typeof useRetainedNativeExport>["download"];
    function Harness() {
      const retained = useRetainedNativeExport("design-1", onError);
      download = retained.download;
      return retained.result ? (
        <RetainedNativeExportLink result={retained.result} label="Retry" />
      ) : null;
    }
    await act(async () => root.render(<Harness />));
    await act(async () =>
      download(new Blob(["legacy"], { type: "image/png" }), "old.png", "png"),
    );
    expect(localEvidence.save).not.toHaveBeenCalled();
    await act(async () =>
      download(new Blob(["native"], { type: "image/png" }), "new.png", "png"),
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "blob:native",
    );
    expect(
      container.querySelector("a")?.dataset.nativeExportLocalEvidence,
    ).toBe("failed");
    expect(onError).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:legacy");
    await act(async () => root.unmount());
    expect(revoke).toHaveBeenCalledWith("blob:native");
  });

  it("aborts a pending local handoff when its result is replaced or the editor closes", async () => {
    localEvidence.enabled.mockReturnValue(true);
    localEvidence.save.mockImplementation(() => new Promise(() => {}));
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let download!: ReturnType<typeof useRetainedNativeExport>["download"];
    function Harness() {
      const retained = useRetainedNativeExport("design-1");
      download = retained.download;
      return retained.result ? (
        <RetainedNativeExportLink result={retained.result} label="Retry" />
      ) : null;
    }
    await act(async () => root.render(<Harness />));
    await act(async () =>
      download(new Blob(["first"], { type: "image/png" }), "first.png", "png"),
    );
    const firstSignal = localEvidence.save.mock.calls[0]?.[0].signal as
      | AbortSignal
      | undefined;
    expect(firstSignal?.aborted).toBe(false);
    await act(async () =>
      download(
        new Blob(["second"], { type: "video/mp4" }),
        "second.mp4",
        "mp4",
      ),
    );
    const secondSignal = localEvidence.save.mock.calls[1]?.[0].signal as
      | AbortSignal
      | undefined;
    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(secondSignal?.aborted).toBe(true);
  });

  it("retires an earlier Blob URL even when two downloads start before React commits", async () => {
    localEvidence.enabled.mockReturnValue(false);
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let download!: ReturnType<typeof useRetainedNativeExport>["download"];
    function Harness() {
      const retained = useRetainedNativeExport("design-1");
      download = retained.download;
      return retained.result ? (
        <RetainedNativeExportLink result={retained.result} label="Retry" />
      ) : null;
    }
    await act(async () => root.render(<Harness />));
    await act(async () => {
      download(new Blob(["one"]), "one.png", "png");
      download(new Blob(["two"]), "two.png", "png");
    });
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:one");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("blob:two");
    await act(async () => root.unmount());
    expect(revoke).toHaveBeenCalledWith("blob:two");
  });
});
