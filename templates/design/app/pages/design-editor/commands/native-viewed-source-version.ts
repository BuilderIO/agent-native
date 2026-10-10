import { readNativeViewedSourceLease } from "@/components/design/design-canvas/native-viewed-source-lease";
import { NativeSceneExportError } from "@/pages/design-editor/native-scene-export-client";

type NativeViewedSource = {
  iframe: HTMLIFrameElement;
  doc: Document;
};

export function readNativeViewedSourceVersion({
  iframe,
  doc,
}: NativeViewedSource): string {
  let viewedDocument: Document | null;
  let viewedWindow: Window | null;
  try {
    viewedDocument = iframe.contentDocument;
    viewedWindow = iframe.contentWindow;
  } catch {
    viewedDocument = null;
    viewedWindow = null;
  }
  if (!iframe.isConnected || viewedDocument !== doc || !viewedWindow)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native preview is no longer the viewed Design source.",
    );
  const versionHash = readNativeViewedSourceLease(iframe, doc);
  if (!versionHash)
    throw new NativeSceneExportError(
      "scene-unreadable",
      "The selected native preview has no readable source version.",
    );
  return versionHash;
}

export function pinNativeViewedSource(source: NativeViewedSource): {
  expectedVersionHash: string;
  assertStillViewed: () => void;
} {
  const expectedVersionHash = readNativeViewedSourceVersion(source);
  return {
    expectedVersionHash,
    assertStillViewed: () => {
      let currentVersionHash: string;
      try {
        currentVersionHash = readNativeViewedSourceVersion(source);
      } catch {
        throw new NativeSceneExportError(
          "source-stale",
          "The viewed Design source changed before native export capture.",
        );
      }
      if (currentVersionHash !== expectedVersionHash)
        throw new NativeSceneExportError(
          "source-stale",
          "The viewed Design source changed before native export capture.",
        );
    },
  };
}
