import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ElementSnapshot } from "../open-slide-editor/types";
import {
  isSlideFrameNavigationInput,
  isSlideFrameMessage,
  isSlideFramePointerType,
  type SlideFrameCommand,
  type SlideFrameContext,
  type SlideFrameMessage,
  type SlideFrameNavigationInput,
  type SlideFramePointerType,
  type SlideFrameTextRangeStyle,
  type SlideRenderArtifact,
  buildSlideSrcDoc,
  isSlideRenderArtifact,
} from "./protocol";

const MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR = 8_000;

type FramePointer = {
  phase: "down" | "move" | "up" | "cancel" | "double-click";
  x: number;
  y: number;
  button: number;
  pointerId: number;
  pointerType: SlideFramePointerType;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: {
    line: number;
    column: number;
    nodeId: string;
    snapshot: ElementSnapshot;
  } | null;
};

type Props = {
  artifact: SlideRenderArtifact;
  title: string;
  onNodes: (nodes: ElementSnapshot[]) => void;
  onPointer: (pointer: FramePointer) => void;
  onPointerActivity?: (pointerType: SlideFramePointerType) => void;
  onKeyboard?: (key: FrameKeyboard) => void;
  onController?: (controller: SlideFrameController | null) => void;
  onNavigationInput?: (input: SlideFrameNavigationInput) => void;
  onTextRangeStyle?: (rangeStyle: SlideFrameTextRangeStyle) => void;
  onReady?: () => void;
  onStepCount?: (stepCount: number) => void;
  initialRevealedSteps?: number | null;
  onError?: (message: string) => void;
  className?: string;
};

export type SandboxedSlideRenderResult = {
  deckId: string;
  slideId: string;
  revision: number;
  sourceHash: string;
  width: number;
  height: number;
  html: string;
  styles: string[];
  assetUrls: Record<string, string>;
  assetOrigins: string[];
  fontOrigins?: string[];
  fontAssets?: NonNullable<SlideRenderArtifact["fontAssets"]>;
  design?: NonNullable<SlideRenderArtifact["runtime"]>["design"];
  designTokens?: SlideRenderArtifact["designTokens"];
  stepCount: number;
};

export type FrameKeyboard = {
  key: string;
  keyCode: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isTypingTarget: boolean;
  isControlTarget: boolean;
  isComposing: boolean;
};

export type SlideFrameController = {
  send: (command: SlideFrameCommand) => void;
};

export async function renderSlideArtifactInSandbox(
  artifact: SlideRenderArtifact,
  appOrigin = window.location.origin,
  initialRevealedSteps: number | null = null,
): Promise<SandboxedSlideRenderResult> {
  if (!isSlideRenderArtifact(artifact, appOrigin)) {
    throw new Error("invalid-slide-render-artifact");
  }
  const runtime = artifact.runtime;
  if (!runtime) {
    return {
      deckId: artifact.deckId,
      slideId: artifact.slideId,
      revision: artifact.revision,
      sourceHash: artifact.sourceHash,
      width: artifact.width,
      height: artifact.height,
      html: artifact.html,
      styles: [],
      assetUrls: {},
      assetOrigins: artifact.assetOrigins ?? [],
      fontOrigins: artifact.fontOrigins ?? [],
      fontAssets: artifact.fontAssets ?? [],
      designTokens: artifact.designTokens,
      stepCount: 0,
    };
  }
  const nonce = createNonce();
  if (!nonce) throw new Error("secure-slide-render-unavailable");
  const context: SlideFrameContext = {
    deckId: artifact.deckId,
    slideId: artifact.slideId,
    revision: artifact.revision,
    sourceHash: artifact.sourceHash,
    nonce,
  };
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1920px;height:1080px;opacity:0;pointer-events:none;border:0";
  const srcDoc = buildSlideSrcDoc(
    artifact,
    nonce,
    appOrigin,
    initialRevealedSteps,
  );

  return new Promise<SandboxedSlideRenderResult>((resolve, reject) => {
    let frameBootstrapped = false;
    const handleError = () => {
      cleanup();
      reject(new Error("slide-render-navigation-failed"));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      frame.removeEventListener("error", handleError);
      frame.remove();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          frameBootstrapped
            ? "slide-render-bridge-timeout"
            : "slide-render-navigation-timeout",
        ),
      );
    }, runtime.timeoutMs + 1_000);
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== "null" ||
        !isSlideFrameMessage(event.data, context)
      ) {
        return;
      }
      const message = event.data as SlideFrameMessage;
      if (message.type === "bootstrapped") {
        frameBootstrapped = true;
        return;
      }
      if (message.type === "error") {
        cleanup();
        reject(
          new Error(
            message.stage === "worker"
              ? "slide-render-worker-failed"
              : "slide-render-failed",
          ),
        );
        return;
      }
      if (message.type !== "rendered" || typeof message.html !== "string") {
        return;
      }
      if (typeof message.stepCount !== "number") {
        cleanup();
        reject(new Error("slide-render-invalid-step-count"));
        return;
      }
      cleanup();
      resolve({
        deckId: artifact.deckId,
        slideId: artifact.slideId,
        revision: artifact.revision,
        sourceHash: artifact.sourceHash,
        width: artifact.width,
        height: artifact.height,
        html: message.html,
        styles: runtime.styles,
        assetUrls: runtime.assetUrls,
        assetOrigins: artifact.assetOrigins ?? [],
        fontOrigins: artifact.fontOrigins ?? [],
        fontAssets: artifact.fontAssets ?? [],
        ...(runtime.design ? { design: runtime.design } : {}),
        ...(artifact.designTokens
          ? { designTokens: artifact.designTokens }
          : {}),
        stepCount: message.stepCount,
      });
    };
    window.addEventListener("message", handleMessage);
    frame.addEventListener("error", handleError);
    document.body.append(frame);
    frame.srcdoc = srcDoc;
  });
}

function createNonce(): string | null {
  if (typeof crypto === "undefined" || !("getRandomValues" in crypto)) {
    return null;
  }
  const values = new Uint8Array(24);
  crypto.getRandomValues(values);
  return Array.from(values, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseElementSnapshot(value: unknown): ElementSnapshot | null {
  if (!isRecord(value) || !isRecord(value.bounds) || !isRecord(value.styles))
    return null;
  const { line, column, nodeId, tagName, text, bounds, styles } = value;
  if (
    !Number.isInteger(line) ||
    Number(line) < 1 ||
    !Number.isInteger(column) ||
    Number(column) < 0 ||
    typeof nodeId !== "string" ||
    nodeId.length > 100 ||
    typeof tagName !== "string" ||
    tagName.length > 32 ||
    typeof text !== "string" ||
    text.length > 12000
  ) {
    return null;
  }
  const instanceIndex = value.instanceIndex;
  const instanceCount = value.instanceCount;
  const instanceNodeId = /^(\d+):(\d+):(\d+)$/.exec(nodeId);
  const hasInstanceMetadata =
    Number.isSafeInteger(instanceIndex) &&
    Number(instanceIndex) >= 0 &&
    Number.isSafeInteger(instanceCount) &&
    Number(instanceCount) > 0 &&
    Number(instanceCount) <= MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR &&
    Number(instanceIndex) < Number(instanceCount) &&
    Number(instanceNodeId?.[1]) === Number(line) &&
    Number(instanceNodeId?.[2]) === Number(column) &&
    Number(instanceNodeId?.[3]) === Number(instanceIndex);
  const rectValues = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (
    rectValues.some(
      (entry) => typeof entry !== "number" || !Number.isFinite(entry),
    )
  ) {
    return null;
  }
  const rect = {
    x: bounds.x as number,
    y: bounds.y as number,
    width: bounds.width as number,
    height: bounds.height as number,
  };
  const safeStyles: Record<string, string> = {};
  for (const [key, entry] of Object.entries(styles)) {
    if (typeof entry !== "string" || entry.length > 400) continue;
    safeStyles[key] = entry;
  }
  let transform: ElementSnapshot["transform"];
  if (isRecord(value.transform)) {
    const { basis, translate, width, height, rotation } = value.transform;
    if (
      isRecord(basis) &&
      isRecord(translate) &&
      [
        basis.a,
        basis.b,
        basis.c,
        basis.d,
        translate.x,
        translate.y,
        width,
        height,
        rotation,
      ].every((entry) => typeof entry === "number" && Number.isFinite(entry)) &&
      Number(width) >= 0 &&
      Number(height) >= 0
    ) {
      transform = {
        basis: {
          a: Number(basis.a),
          b: Number(basis.b),
          c: Number(basis.c),
          d: Number(basis.d),
        },
        translate: { x: Number(translate.x), y: Number(translate.y) },
        width: Number(width),
        height: Number(height),
        rotation: Number(rotation),
      };
    }
  }
  return {
    line: Number(line),
    column: Number(column),
    ...(hasInstanceMetadata
      ? {
          instanceIndex: Number(instanceIndex),
          instanceCount: Number(instanceCount),
        }
      : {}),
    nodeId,
    tagName,
    text,
    bounds: rect,
    styles: safeStyles,
    ...(transform ? { transform } : {}),
  };
}

function parsePointer(value: unknown): FramePointer | null {
  if (!isRecord(value)) return null;
  const {
    phase,
    x,
    y,
    button,
    pointerId,
    pointerType,
    shiftKey,
    altKey,
    ctrlKey,
    metaKey,
    target,
  } = value;
  if (
    (phase !== "down" &&
      phase !== "move" &&
      phase !== "up" &&
      phase !== "cancel" &&
      phase !== "double-click") ||
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y) ||
    typeof button !== "number" ||
    !Number.isInteger(pointerId) ||
    !isSlideFramePointerType(pointerType) ||
    typeof shiftKey !== "boolean" ||
    typeof altKey !== "boolean" ||
    typeof ctrlKey !== "boolean" ||
    typeof metaKey !== "boolean"
  ) {
    return null;
  }
  let safeTarget: FramePointer["target"] = null;
  if (
    isRecord(target) &&
    Number.isInteger(target.line) &&
    Number(target.line) > 0 &&
    Number.isInteger(target.column) &&
    Number(target.column) >= 0 &&
    typeof target.nodeId === "string" &&
    target.nodeId.length <= 100
  ) {
    const snapshot = parseElementSnapshot(target.snapshot);
    if (
      snapshot &&
      snapshot.line === Number(target.line) &&
      snapshot.column === Number(target.column) &&
      snapshot.nodeId === target.nodeId
    ) {
      safeTarget = {
        line: Number(target.line),
        column: Number(target.column),
        nodeId: target.nodeId,
        snapshot,
      };
    }
  }
  return {
    phase,
    x,
    y,
    button,
    pointerId: Number(pointerId),
    pointerType,
    shiftKey,
    altKey,
    ctrlKey,
    metaKey,
    target: safeTarget,
  };
}

export function SandboxedSlide({
  artifact,
  title,
  onNodes,
  onPointer,
  onPointerActivity,
  onKeyboard,
  onController,
  onNavigationInput,
  onTextRangeStyle,
  onReady,
  onStepCount,
  initialRevealedSteps = null,
  onError,
  className,
}: Props) {
  const t = useT();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameBootstrapTimeoutRef = useRef<number | null>(null);
  const frameHostRef = useRef<HTMLDivElement>(null);
  const onNodesRef = useRef(onNodes);
  const [nonce, setNonce] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  const artifactIsValid = useMemo(
    () =>
      typeof window !== "undefined" &&
      isSlideRenderArtifact(artifact, window.location.origin),
    [artifact],
  );
  const hasRuntime = Boolean(artifact.runtime);
  onNodesRef.current = onNodes;
  onErrorRef.current = onError;
  const sourceKey = `${artifact.deckId}:${artifact.slideId}:${artifact.revision}:${artifact.sourceHash}`;
  const context = useMemo<SlideFrameContext | null>(
    () =>
      nonce
        ? {
            deckId: artifact.deckId,
            slideId: artifact.slideId,
            revision: artifact.revision,
            sourceHash: artifact.sourceHash,
            nonce,
          }
        : null,
    [
      artifact.deckId,
      artifact.slideId,
      artifact.revision,
      artifact.sourceHash,
      nonce,
    ],
  );
  const srcDoc = useMemo(
    () =>
      context && artifactIsValid && typeof window !== "undefined"
        ? buildSlideSrcDoc(
            artifact,
            context.nonce,
            window.location.origin,
            initialRevealedSteps,
          )
        : "",
    [artifact, artifactIsValid, context, initialRevealedSteps],
  );

  useEffect(() => {
    if (!artifactIsValid) {
      onErrorRef.current?.(t("openSlideEditor.invalidRenderArtifact"));
      setNonce(null);
      onNodesRef.current([]);
      return;
    }
    try {
      const nextNonce = createNonce();
      if (!nextNonce) {
        onErrorRef.current?.(t("openSlideEditor.secureRenderUnavailable"));
        setNonce(null);
      } else {
        setNonce(nextNonce);
      }
    } catch {
      onErrorRef.current?.(t("openSlideEditor.secureRenderUnavailable"));
      setNonce(null);
    }
    onNodesRef.current([]);
  }, [artifactIsValid, sourceKey, t]);

  const handleMessage = useCallback(
    (event: MessageEvent<unknown>) => {
      const frame = frameRef.current;
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      if (
        event.origin !== "null" ||
        !context ||
        !isSlideFrameMessage(event.data, context)
      )
        return;
      const message = event.data as SlideFrameMessage;
      if (message.type === "bootstrapped") {
        if (frame.dataset.frameReady !== "error") {
          frame.dataset.frameNavigation = "bootstrapped";
        }
      } else if (message.type === "ready") {
        if (frameBootstrapTimeoutRef.current !== null) {
          window.clearTimeout(frameBootstrapTimeoutRef.current);
          frameBootstrapTimeoutRef.current = null;
        }
        delete frame.dataset.frameFailure;
        frame.dataset.frameReady = "ready";
        if (!hasRuntime) onStepCount?.(0);
        onReady?.();
      } else if (message.type === "rendered") {
        if (typeof message.stepCount === "number") {
          onStepCount?.(message.stepCount);
        } else {
          onError?.(t("openSlideEditor.renderFailed"));
        }
      } else if (
        (message.type === "snapshot" || message.type === "inspect") &&
        Array.isArray(message.nodes)
      ) {
        onNodes(
          message.nodes.flatMap((node) => {
            const parsed = parseElementSnapshot(node);
            return parsed ? [parsed] : [];
          }),
        );
      } else if (message.type === "text-range-style" && message.rangeStyle) {
        onTextRangeStyle?.(message.rangeStyle);
      } else if (message.type === "pointer") {
        const pointer = parsePointer(message.pointer);
        if (pointer) {
          if (pointer.phase === "down") {
            onPointerActivity?.(pointer.pointerType);
          }
          onPointer(pointer);
        }
      } else if (message.type === "keyboard") {
        const keyboard = message.keyboard;
        if (
          isRecord(keyboard) &&
          typeof keyboard.key === "string" &&
          keyboard.key.length <= 64 &&
          Number.isInteger(keyboard.keyCode) &&
          Number(keyboard.keyCode) >= 0 &&
          Number(keyboard.keyCode) <= 65535 &&
          typeof keyboard.shiftKey === "boolean" &&
          typeof keyboard.altKey === "boolean" &&
          typeof keyboard.ctrlKey === "boolean" &&
          typeof keyboard.metaKey === "boolean" &&
          typeof keyboard.isTypingTarget === "boolean" &&
          typeof keyboard.isControlTarget === "boolean" &&
          typeof keyboard.isComposing === "boolean"
        ) {
          onKeyboard?.({
            key: keyboard.key,
            keyCode: Number(keyboard.keyCode),
            shiftKey: keyboard.shiftKey,
            altKey: keyboard.altKey,
            ctrlKey: keyboard.ctrlKey,
            metaKey: keyboard.metaKey,
            isTypingTarget: keyboard.isTypingTarget,
            isControlTarget: keyboard.isControlTarget,
            isComposing: keyboard.isComposing,
          });
        }
      } else if (
        message.type === "navigation" &&
        isSlideFrameNavigationInput(message.navigation)
      ) {
        onNavigationInput?.(message.navigation);
      } else if (message.type === "error") {
        if (frameBootstrapTimeoutRef.current !== null) {
          window.clearTimeout(frameBootstrapTimeoutRef.current);
          frameBootstrapTimeoutRef.current = null;
        }
        frame.dataset.frameFailure =
          message.stage === "worker" ? "worker" : "bridge";
        frame.dataset.frameReady = "error";
        onError?.(t("openSlideEditor.renderFailed"));
      }
    },
    [
      context,
      hasRuntime,
      onError,
      onNavigationInput,
      onNodes,
      onPointer,
      onPointerActivity,
      onTextRangeStyle,
      onReady,
      onStepCount,
      t,
    ],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    const host = frameHostRef.current;
    if (!host || !srcDoc) return;

    const frame = document.createElement("iframe");
    frame.title = title;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.referrerPolicy = "no-referrer";
    frame.className = `block h-full w-full border-0 ${className ?? ""}`;
    frame.dataset.openSlideFrame = "";
    frame.dataset.frameReady = nonce ? "pending" : "initializing";
    frame.dataset.frameNavigation = "pending";
    const handleLoad = () => {
      frame.dataset.frameLoadEvent = "observed";
    };
    const handleError = () => {
      frame.dataset.frameNavigation = "error";
      frame.dataset.frameFailure = "navigation";
      frame.dataset.frameReady = "error";
      if (frameBootstrapTimeoutRef.current !== null) {
        window.clearTimeout(frameBootstrapTimeoutRef.current);
        frameBootstrapTimeoutRef.current = null;
      }
      onErrorRef.current?.(t("openSlideEditor.renderFailed"));
    };
    frame.addEventListener("load", handleLoad);
    frame.addEventListener("error", handleError);
    frameRef.current = frame;
    host.replaceChildren(frame);
    frame.srcdoc = srcDoc;
    frameBootstrapTimeoutRef.current = window.setTimeout(
      () => {
        frameBootstrapTimeoutRef.current = null;
        if (frame.dataset.frameReady === "ready" || !frame.isConnected) return;
        frame.dataset.frameFailure =
          frame.dataset.frameNavigation === "bootstrapped"
            ? "bridge"
            : "navigation";
        frame.dataset.frameReady = "error";
        onErrorRef.current?.(t("openSlideEditor.renderFailed"));
      },
      Math.max(3_500, (artifact.runtime?.timeoutMs ?? 0) + 1_000),
    );

    return () => {
      if (frameBootstrapTimeoutRef.current !== null) {
        window.clearTimeout(frameBootstrapTimeoutRef.current);
        frameBootstrapTimeoutRef.current = null;
      }
      frame.removeEventListener("load", handleLoad);
      frame.removeEventListener("error", handleError);
      if (frame.parentElement === host) host.removeChild(frame);
      if (frameRef.current === frame) frameRef.current = null;
    };
  }, [artifact.runtime?.timeoutMs, className, nonce, srcDoc, t, title]);

  const sendCommand = useCallback(
    (command: SlideFrameCommand) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || !context) return;
      frameWindow.postMessage(
        {
          protocolVersion: artifact.protocolVersion,
          nonce: context.nonce,
          deckId: context.deckId,
          slideId: context.slideId,
          revision: context.revision,
          sourceHash: context.sourceHash,
          ...command,
        },
        "*",
      );
    },
    [artifact.protocolVersion, context],
  );

  useEffect(() => {
    onController?.({ send: sendCommand });
    return () => onController?.(null);
  }, [onController, sendCommand]);

  return (
    <div
      ref={frameHostRef}
      className={`block h-full w-full ${className ?? ""}`}
    />
  );
}

export type { FramePointer };
