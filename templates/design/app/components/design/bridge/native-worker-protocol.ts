import type {
  EffectDefinition,
  EffectInstance,
} from "../../../../shared/native-effects";
import type { NativeEffectExtentPlan } from "./native-effect-extent";
import type { NativeSourceRecord } from "./native-source-provider";

export const NATIVE_WORKER_PROTOCOL_VERSION = 1;

export type NativeWorkerSourceRecord = Omit<
  NativeSourceRecord,
  "node" | "source"
> & {
  nodeId: string;
  assetId?: string;
};

export type NativeWorkerEffectTarget = {
  instanceId: string;
  definitionHash: string;
  width: number;
  height: number;
  pixelRatio: number;
  rect: { x: number; y: number; width: number; height: number };
  outputExtent: NativeEffectExtentPlan | null;
  cornerRadii?: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  sourceAssetId?: string;
  maskAssetId?: string;
  textMaskAssetId?: string;
  receiverGeometryAssetId?: string;
  receiverInteriorAssetId?: string;
  sourceRecords: readonly NativeWorkerSourceRecord[];
  groupLocalOwnerId?: string;
  fillLocalSourceRecords?: readonly NativeWorkerSourceRecord[];
  fillPhases?: {
    backgroundRecords: readonly NativeWorkerSourceRecord[];
    borderRecords: readonly NativeWorkerSourceRecord[];
    outerCoverageRecords: readonly NativeWorkerSourceRecord[];
    innerCoverageRecords: readonly NativeWorkerSourceRecord[];
    glyphRecords: readonly NativeWorkerSourceRecord[];
    insetShadowRecords: readonly NativeWorkerSourceRecord[];
    outerShadowRecords: readonly NativeWorkerSourceRecord[];
    outlineRecords: readonly NativeWorkerSourceRecord[];
    foregroundRecords: readonly NativeWorkerSourceRecord[];
  };
};

export type NativeWorkerAsset =
  | {
      kind: "bitmap";
      sceneId: string;
      generation: number;
      assetId: string;
      revision: number;
      bitmap: ImageBitmap;
    }
  | {
      kind: "rgba16float";
      sceneId: string;
      generation: number;
      assetId: string;
      revision: number;
      width: number;
      height: number;
      data: ArrayBuffer;
    };

export type NativeWorkerScene = {
  sceneId: string;
  generation: number;
  sourceEpoch: number;
  authoredEpoch: number;
  viewport: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  pixelRatio: number;
  colorSpace: "srgb" | "display-p3";
  frameRateTarget?: 60 | 120;
  clock: { playing: boolean; timeSeconds: number; speed: number };
  requiredAssets: readonly { assetId: string; revision: number }[];
  definitions: readonly EffectDefinition[];
  instances: readonly EffectInstance[];
  targets: readonly NativeWorkerEffectTarget[];
  records: readonly NativeWorkerSourceRecord[];
  backdropRecords?: readonly NativeWorkerSourceRecord[];
};

export type NativeWorkerToGpu =
  | {
      type: "init";
      protocol: typeof NATIVE_WORKER_PROTOCOL_VERSION;
      sceneId: string;
      canvas: OffscreenCanvas;
    }
  | { type: "scene"; scene: NativeWorkerScene }
  | ({ type: "asset" } & NativeWorkerAsset)
  | {
      type: "export";
      sceneId: string;
      requestId: string;
      generation: number;
      sourceEpoch: number;
      timeSeconds: number;
      selectedInstanceIds?: readonly string[];
      selectedNodeIds?: readonly string[];
      cropRect: { x: number; y: number; width: number; height: number };
      pixelRatio: number;
    }
  | {
      type: "export-scene";
      sceneId: string;
      requestId: string;
      scene: NativeWorkerScene;
      timeSeconds: number;
      selectionFiltered: boolean;
      selectedInstanceIds?: readonly string[];
      selectedNodeIds?: readonly string[];
      cropRect: { x: number; y: number; width: number; height: number };
      pixelRatio: number;
    }
  | { type: "cancel-export"; sceneId: string; requestId: string }
  | { type: "visibility"; sceneId: string; visible: boolean }
  | { type: "dispose"; sceneId: string };

export type NativeWorkerFromGpu =
  | {
      type: "ready";
      sceneId: string;
      protocol: typeof NATIVE_WORKER_PROTOCOL_VERSION;
    }
  | {
      type: "scene-staged";
      sceneId: string;
      generation: number;
      sourceEpoch: number;
    }
  | {
      type: "committed";
      sceneId: string;
      generation: number;
      sourceEpoch: number;
      frame: number;
      timeSeconds: number;
      presentedAtMs: number;
      committedInstances?: readonly {
        instanceId: string;
        definitionHash: string;
        payload: string;
        localTime: number;
      }[];
    }
  | {
      type: "exported";
      sceneId: string;
      requestId: string;
      generation: number;
      sourceEpoch: number;
      width: number;
      height: number;
      rgba: ArrayBuffer;
      timeSeconds: number;
      committedInstances: readonly {
        instanceId: string;
        definitionHash: string;
        payload: string;
        localTime: number;
      }[];
    }
  | {
      type: "error";
      sceneId: string;
      requestId?: string;
      generation?: number;
      code: string;
      message: string;
    };
