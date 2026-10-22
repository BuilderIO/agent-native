import { attachNativePreviewViewportPublisher } from "../bridge/native-preview-viewport-transport";
import { installNativeWorkerBroker } from "../bridge/native-worker-broker";
import { withNativeShaderRuntime } from "./local-runtime";
import {
  connectNativePublicAssetPreview,
  prepareNativePublicAssetPreviewDocument,
  type NativePublicAssetPreviewDocument,
} from "./native-public-asset-preview";
import {
  connectNativePublicWorkerPreview,
  prepareNativePublicWorkerPreviewDocument,
  type NativePublicWorkerPreviewDocument,
} from "./native-public-worker-preview";

export type NativePreviewSurfaceProfile =
  | "interactive"
  | "overview"
  | "thumbnail"
  | "catalog";

export interface NativePreviewSurfaceDocument {
  html: string;
  profile: NativePreviewSurfaceProfile;
  publicAsset: NativePublicAssetPreviewDocument | null;
  publicWorker: NativePublicWorkerPreviewDocument | null;
}

export function nativePreviewSurfaceDocumentKey(
  prepared: NativePreviewSurfaceDocument | null,
): string | null {
  return prepared?.publicWorker?.nonce ?? prepared?.publicAsset?.nonce ?? null;
}

export function prepareNativePreviewSurface({
  html,
  sandbox,
  profile,
  approvedHashes = [],
  baseHref,
  alwaysRuntime = false,
  initialPixelRatio,
  animationEpochMs,
}: {
  html: string;
  sandbox: string;
  profile: NativePreviewSurfaceProfile;
  approvedHashes?: readonly string[];
  baseHref?: string;
  alwaysRuntime?: boolean;
  initialPixelRatio?: number;
  animationEpochMs?: number;
}): NativePreviewSurfaceDocument {
  let runtimeHtml = withNativeShaderRuntime(html, alwaysRuntime);
  const runtimeAttributes: string[] = [];
  if (initialPixelRatio !== undefined) {
    if (!Number.isFinite(initialPixelRatio) || initialPixelRatio <= 0)
      throw new Error("native-preview-pixel-ratio-invalid");
    runtimeAttributes.push(
      `data-agent-native-export-initial-pixel-ratio="${initialPixelRatio}"`,
    );
  }
  if (animationEpochMs !== undefined) {
    if (!Number.isFinite(animationEpochMs) || animationEpochMs <= 0)
      throw new Error("native-preview-animation-epoch-invalid");
    runtimeAttributes.push(
      `data-agent-native-animation-epoch-ms="${animationEpochMs}"`,
    );
  }
  if (runtimeAttributes.length) {
    const marker =
      '<script data-agent-native-native-shader-runtime data-runtime-version="2">';
    if (!runtimeHtml.includes(marker) && initialPixelRatio !== undefined)
      throw new Error("native-preview-runtime-marker-missing");
    runtimeHtml = runtimeHtml.replace(
      marker,
      `<script data-agent-native-native-shader-runtime data-runtime-version="2" ${runtimeAttributes.join(" ")}>`,
    );
  }
  const staticNonce = html.match(
    /<meta\s+name="an-native-static-script-nonce"\s+content="([A-Za-z0-9-]{16,80})"\s*>/i,
  )?.[1];
  if (
    staticNonce &&
    runtimeHtml.includes("data-agent-native-native-shader-runtime")
  )
    runtimeHtml = runtimeHtml.replace(
      "<script data-agent-native-native-shader-runtime",
      `<script nonce="${staticNonce}" data-agent-native-native-shader-runtime`,
    );
  if (!baseHref || sandbox.includes("allow-same-origin"))
    return {
      html: runtimeHtml,
      profile,
      publicAsset: null,
      publicWorker: null,
    };
  const publicWorker = prepareNativePublicWorkerPreviewDocument(
    runtimeHtml,
    approvedHashes,
  );
  const publicAsset = prepareNativePublicAssetPreviewDocument(
    publicWorker?.html ?? runtimeHtml,
    baseHref,
    publicWorker?.manifest,
  );
  return { html: publicAsset.html, profile, publicAsset, publicWorker };
}

export function connectNativePreviewSurface(
  frame: HTMLIFrameElement,
  prepared: NativePreviewSurfaceDocument | null,
): () => void {
  const host = frame.ownerDocument.defaultView;
  if (host) installNativeWorkerBroker(host);
  const cleanups = [attachNativePreviewViewportPublisher(frame)];
  const sendProfile = () => {
    if (!prepared) return;
    frame.contentWindow?.postMessage(
      {
        type: "native-shader-overview-preview-mode",
        schemaVersion: 1,
        compact: prepared.profile === "thumbnail",
      },
      "*",
    );
  };
  frame.addEventListener("load", sendProfile);
  sendProfile();
  cleanups.push(() => frame.removeEventListener("load", sendProfile));
  try {
    if (prepared?.publicAsset)
      cleanups.push(
        connectNativePublicAssetPreview(frame, prepared.publicAsset),
      );
    if (prepared?.publicWorker)
      cleanups.push(
        connectNativePublicWorkerPreview(
          frame,
          prepared.publicWorker,
          prepared.html,
        ),
      );
  } catch (error) {
    for (const cleanup of cleanups.reverse()) cleanup();
    throw error;
  }
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
