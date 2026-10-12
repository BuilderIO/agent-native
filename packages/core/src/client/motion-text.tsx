import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";

import "./motion-text.css";
import {
  isMotionEaseVariableReference,
  isValidMotionEase,
  resolveMotionEaseForWebAnimations,
} from "../shared/motion-easing.js";

export type MotionTextUnit = "character" | "word" | "line" | "paragraph";
export type MotionTextDirection = "forward" | "reverse";
export type MotionTextProperty =
  | "opacity"
  | "translate"
  | "scale"
  | "rotate"
  | "filter";
export type MotionTextPlaybackMode = "loop" | "once" | "ping-pong";

export interface MotionTextKeyframe {
  t: number;
  value: string;
  ease?: string;
}

export interface MotionTextAnimation {
  targetNodeId: string;
  unit: MotionTextUnit;
  direction: MotionTextDirection;
  staggerMs: number;
  delayMs?: number;
  property: MotionTextProperty;
  durationMs: number;
  keyframes: MotionTextKeyframe[];
}

export interface AgentNativeMotionTextProps {
  animation?: MotionTextAnimation;
  animations?: MotionTextAnimation[];
  playbackMode?: MotionTextPlaybackMode;
  children: ReactElement;
}

type MotionTextHostProps = Record<string, unknown> & {
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
};
type MotionTextNode = ReactElement<
  Record<string, unknown> & { children?: ReactNode }
>;

interface MotionTextUnitToken {
  text: string;
  animated: boolean;
}

interface MotionTextToken extends MotionTextUnitToken {
  start: number;
  end: number;
  index: number;
}

const MOTION_TEXT_UNITS = new Set<MotionTextUnit>([
  "character",
  "word",
  "line",
  "paragraph",
]);
const MOTION_TEXT_PROPERTIES = new Set<MotionTextProperty>([
  "opacity",
  "translate",
  "scale",
  "rotate",
  "filter",
]);
const MOTION_TEXT_PLAYBACK_MODES = new Set<MotionTextPlaybackMode>([
  "loop",
  "once",
  "ping-pong",
]);
const PARAGRAPH_TAGS = new Set([
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
]);
const INLINE_TEXT_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);
const MAX_TEXT_UNITS = 512;
const PREVIEW_MESSAGE_TYPES = new Set([
  "motion-preview",
  "motion-preview-clear",
]);

/**
 * Applies static text property animations to a single intrinsic JSX host element.
 * Importing this entry includes the package stylesheet; the same asset is
 * available as `@agent-native/core/client/motion-text.css` for CSS-only setups.
 */
export function AgentNativeMotionText({
  animation,
  animations: animationList,
  playbackMode = "once",
  children,
}: AgentNativeMotionTextProps) {
  if (animation && animationList) {
    throw new Error(
      "AgentNativeMotionText accepts animation or animations, not both.",
    );
  }
  const animations = animationList ?? (animation ? [animation] : []);
  validateAnimations(animations);
  const primaryAnimation = animations[0]!;
  validatePlaybackMode(playbackMode);

  const child = Children.only(children);
  if (!isValidElement(child) || typeof child.type !== "string") {
    throw new Error(
      "AgentNativeMotionText requires exactly one intrinsic host JSX child.",
    );
  }

  const host = child as ReactElement<MotionTextHostProps>;
  if (
    host.props["data-agent-native-node-id"] !== primaryAnimation.targetNodeId
  ) {
    throw new Error(
      "AgentNativeMotionText animation.targetNodeId must match the child’s static data-agent-native-node-id.",
    );
  }

  const [motionAllowed, setMotionAllowed] = useState(false);
  const hostRef = useRef<HTMLElement | null>(null);
  const childRef = host.props.ref;
  const setHostRef = useCallback(
    (element: HTMLElement | null) => {
      hostRef.current = element;
      if (typeof childRef === "function") {
        if (!element) {
          childRef(null);
          return;
        }
        const cleanup = childRef(element);
        return () => {
          hostRef.current = null;
          if (typeof cleanup === "function") cleanup();
          else childRef(null);
        };
      }
      assignRef(childRef, element);
      if (element) {
        return () => {
          hostRef.current = null;
          assignRef(childRef, null);
        };
      }
    },
    [childRef],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setMotionAllowed(true);
      return;
    }
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setMotionAllowed(!preference.matches);
    updatePreference();
    preference.addEventListener?.("change", updatePreference);
    return () => preference.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!motionAllowed) return;
    const hostElement = hostRef.current;
    if (!hostElement) return;

    const elements = resolveMotionUnits(hostElement, primaryAnimation);
    if (elements.length === 0) {
      throw new Error("AgentNativeMotionText found no animatable text units.");
    }
    const groupCount = elements.reduce(
      (count, entry) => Math.max(count, entry.index + 1),
      0,
    );
    if (groupCount > MAX_TEXT_UNITS) {
      throw new Error(
        `AgentNativeMotionText supports at most ${MAX_TEXT_UNITS} animated units.`,
      );
    }
    if ((groupCount - 1) * primaryAnimation.staggerMs > 120_000) {
      throw new Error(
        "AgentNativeMotionText stagger exceeds the 120000ms runtime limit.",
      );
    }

    const previewAnimations: Array<{
      animation: Animation;
      delay: number;
      durationMs: number;
    }> = [];
    try {
      for (const track of animations) {
        for (const entry of elements) {
          if (typeof entry.element.animate !== "function") {
            throw new Error(
              "AgentNativeMotionText requires the Web Animations API.",
            );
          }
          const delayIndex =
            track.direction === "reverse"
              ? groupCount - 1 - entry.index
              : entry.index;
          const easingStyle = track.keyframes.some((keyframe) =>
            isMotionEaseVariableReference(keyframe.ease ?? ""),
          )
            ? window.getComputedStyle(entry.element)
            : null;
          const keyframes = track.keyframes.map((keyframe) => ({
            offset: keyframe.t,
            easing: resolveMotionEaseForWebAnimations(
              keyframe.ease ?? "ease",
              (name) => easingStyle?.getPropertyValue(name) ?? "",
            ),
            [track.property]: keyframe.value,
          })) as Keyframe[];
          const delay = (track.delayMs ?? 0) + delayIndex * track.staggerMs;
          const runningAnimation = entry.element.animate(keyframes, {
            duration: track.durationMs,
            delay,
            iterations: playbackMode === "once" ? 1 : Infinity,
            direction: playbackMode === "ping-pong" ? "alternate" : "normal",
            fill: "both",
          });
          previewAnimations.push({
            animation: runningAnimation,
            delay,
            durationMs: track.durationMs,
          });
        }
      }
    } catch (error) {
      for (const entry of previewAnimations) {
        entry.animation.cancel();
      }
      throw error;
    }

    let isPreviewing = false;

    const handlePreviewMessage = (event: MessageEvent<unknown>) => {
      if (
        event.source !== window.parent ||
        !isMotionPreviewMessage(event.data)
      ) {
        return;
      }
      if (event.data.type === "motion-preview-clear") {
        if (!isPreviewing) return;
        isPreviewing = false;
        for (const entry of previewAnimations) {
          entry.animation.currentTime = 0;
          entry.animation.play();
        }
        return;
      }

      const t = Number(event.data.t);
      const timelineDuration = Number(event.data.durationMs);
      if (!Number.isFinite(t) || !Number.isFinite(timelineDuration)) return;
      if (timelineDuration <= 0) return;
      if (!isPreviewing) {
        isPreviewing = true;
        for (const entry of previewAnimations) entry.animation.pause();
      }
      const timelineTime = Math.max(0, Math.min(1, t)) * timelineDuration;
      for (const entry of previewAnimations) {
        const elapsed = Math.max(0, timelineTime - entry.delay);
        entry.animation.currentTime =
          playbackMode === "once"
            ? Math.min(entry.durationMs, elapsed)
            : elapsed;
      }
    };
    window.addEventListener("message", handlePreviewMessage);

    return () => {
      window.removeEventListener("message", handlePreviewMessage);
      for (const entry of previewAnimations) {
        entry.animation.cancel();
      }
    };
  }, [animations, motionAllowed, playbackMode, primaryAnimation]);

  const nextUnitIndex = { current: 0 };
  const outputChildren = motionAllowed
    ? primaryAnimation.unit === "paragraph"
      ? renderParagraphs(host.props.children, nextUnitIndex)
      : renderTextNodes(host.props.children, primaryAnimation, nextUnitIndex)
    : host.props.children;

  return cloneElement(host, { ref: setHostRef, children: outputChildren });
}

function validatePlaybackMode(mode: MotionTextPlaybackMode): void {
  if (!MOTION_TEXT_PLAYBACK_MODES.has(mode)) {
    throw new Error("AgentNativeMotionText playbackMode is unsupported.");
  }
}

function validateAnimations(animations: MotionTextAnimation[]): void {
  if (!Array.isArray(animations) || animations.length === 0) {
    throw new Error("AgentNativeMotionText requires at least one animation.");
  }
  const first = animations[0]!;
  const properties = new Set<MotionTextProperty>();
  for (const animation of animations) {
    validateAnimation(animation);
    if (
      animation.targetNodeId !== first.targetNodeId ||
      animation.unit !== first.unit ||
      animation.direction !== first.direction ||
      animation.staggerMs !== first.staggerMs
    ) {
      throw new Error(
        "AgentNativeMotionText animations for one target must share target, unit, direction, and stagger.",
      );
    }
    if (properties.has(animation.property)) {
      throw new Error(
        `AgentNativeMotionText property "${animation.property}" is duplicated.`,
      );
    }
    properties.add(animation.property);
  }
}

function validateAnimation(animation: MotionTextAnimation): void {
  if (!animation || typeof animation !== "object") {
    throw new Error("AgentNativeMotionText animation must be a static object.");
  }
  if (
    typeof animation.targetNodeId !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(animation.targetNodeId)
  ) {
    throw new Error("AgentNativeMotionText targetNodeId is invalid.");
  }
  if (!MOTION_TEXT_UNITS.has(animation.unit)) {
    throw new Error("AgentNativeMotionText unit is unsupported.");
  }
  if (animation.direction !== "forward" && animation.direction !== "reverse") {
    throw new Error("AgentNativeMotionText direction is unsupported.");
  }
  if (!MOTION_TEXT_PROPERTIES.has(animation.property)) {
    throw new Error("AgentNativeMotionText property is unsupported.");
  }
  if (
    !Number.isFinite(animation.staggerMs) ||
    animation.staggerMs < 0 ||
    animation.staggerMs > 5000
  ) {
    throw new Error("AgentNativeMotionText staggerMs is invalid.");
  }
  if (
    animation.delayMs !== undefined &&
    (!Number.isFinite(animation.delayMs) ||
      animation.delayMs < 0 ||
      animation.delayMs > 120_000)
  ) {
    throw new Error("AgentNativeMotionText delayMs is invalid.");
  }
  if (
    !Number.isFinite(animation.durationMs) ||
    animation.durationMs <= 0 ||
    animation.durationMs > 120_000
  ) {
    throw new Error("AgentNativeMotionText durationMs is invalid.");
  }
  if (
    !Array.isArray(animation.keyframes) ||
    animation.keyframes.length < 2 ||
    animation.keyframes.length > 128
  ) {
    throw new Error("AgentNativeMotionText keyframes are invalid.");
  }
  let previousT = -1;
  for (const keyframe of animation.keyframes) {
    if (
      !Number.isFinite(keyframe.t) ||
      keyframe.t < 0 ||
      keyframe.t > 1 ||
      keyframe.t <= previousT ||
      typeof keyframe.value !== "string" ||
      keyframe.value.trim().length === 0 ||
      (keyframe.ease !== undefined &&
        (typeof keyframe.ease !== "string" ||
          !isValidMotionEase(keyframe.ease)))
    ) {
      throw new Error("AgentNativeMotionText keyframes are invalid.");
    }
    previousT = keyframe.t;
  }
  if (
    animation.keyframes[0]?.t !== 0 ||
    animation.keyframes[animation.keyframes.length - 1]?.t !== 1
  ) {
    throw new Error("AgentNativeMotionText keyframes must span [0, 1].");
  }
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function textTokens(
  text: string,
  unit: Exclude<MotionTextUnit, "line" | "paragraph">,
): MotionTextUnitToken[] {
  if (unit === "character") {
    const Segmenter = Intl.Segmenter;
    const parts = Segmenter
      ? Array.from(
          new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
          (part) => part.segment,
        )
      : Array.from(text);
    return parts.map((part) => ({
      text: part,
      animated: !/^\s+$/u.test(part),
    }));
  }

  const Segmenter = Intl.Segmenter;
  const chunks = Segmenter
    ? Array.from(
        new Segmenter(undefined, { granularity: "word" }).segment(text),
        (part) => ({
          text: part.segment,
          word: part.isWordLike,
        }),
      )
    : (text.match(/\s+|[^\s]+/gu) ?? []).map((part) => ({
        text: part,
        word: !/^\s+$/u.test(part),
      }));
  const tokens: MotionTextUnitToken[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    if (/^\s+$/u.test(chunk.text)) {
      tokens.push({ text: chunk.text, animated: false });
    } else if (chunk.word) {
      tokens.push({ text: chunk.text, animated: true });
    } else if (tokens.length && tokens[tokens.length - 1]!.animated) {
      tokens[tokens.length - 1]!.text += chunk.text;
    } else {
      const nextWord = chunks
        .slice(index + 1)
        .findIndex((candidate) => candidate.word);
      if (nextWord >= 0) {
        let punctuation = chunk.text;
        while (
          index + 1 < chunks.length &&
          !chunks[index + 1]!.word &&
          !/^\s+$/u.test(chunks[index + 1]!.text)
        ) {
          punctuation += chunks[++index]!.text;
        }
        tokens.push({ text: punctuation, animated: true });
      } else {
        tokens.push({ text: chunk.text, animated: false });
      }
    }
  }
  return tokens;
}

function renderTextNodes(
  node: ReactNode,
  animation: MotionTextAnimation,
  nextUnitIndex: { current: number },
): ReactNode {
  const textLeaves: Array<{ text: string; start: number; end: number }> = [];
  collectTextLeaves(node, textLeaves, { current: 0 });
  const text = textLeaves.map((leaf) => leaf.text).join("");
  const unit = animation.unit === "character" ? "character" : "word";
  const tokenValues = textTokens(text, unit);
  const tokens: MotionTextToken[] = [];
  let tokenOffset = 0;
  for (const token of tokenValues) {
    const start = tokenOffset;
    const end = start + token.text.length;
    tokenOffset = end;
    tokens.push({ ...token, start, end, index: -1 });
  }
  for (const token of tokens) {
    if (token.animated) token.index = nextUnitIndex.current++;
  }
  if (nextUnitIndex.current > MAX_TEXT_UNITS) {
    throw new Error(
      `AgentNativeMotionText supports at most ${MAX_TEXT_UNITS} animated units.`,
    );
  }

  return mapTextLeaves(node, 0, textLeaves, tokens);
}

function collectTextLeaves(
  node: ReactNode,
  leaves: Array<{ text: string; start: number; end: number }>,
  offset: { current: number },
): void {
  if (typeof node === "string" || typeof node === "number") {
    const text = String(node);
    const start = offset.current;
    leaves.push({ text, start, end: start + text.length });
    offset.current += text.length;
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectTextLeaves(child, leaves, offset);
    return;
  }
  if (isValidElement(node)) {
    if (typeof node.type !== "string" || !INLINE_TEXT_TAGS.has(node.type)) {
      throw new Error(
        "Character, word, and line Motion text supports only static inline host elements.",
      );
    }
    collectTextLeaves(asMotionTextNode(node).props.children, leaves, offset);
  }
}

function mapTextLeaves(
  node: ReactNode,
  leafIndex: number,
  leaves: Array<{ text: string; start: number; end: number }>,
  tokens: MotionTextToken[],
): ReactNode {
  if (typeof node === "string" || typeof node === "number") {
    const leaf = leaves[leafIndex];
    return renderTextLeaf(leaf, tokens);
  }
  if (Array.isArray(node)) {
    let nextLeafIndex = leafIndex;
    const mapped = node.map((child) => {
      const mappedChild = mapTextLeaves(child, nextLeafIndex, leaves, tokens);
      nextLeafIndex += countTextLeaves(child);
      return mappedChild;
    });
    return mapped;
  }
  if (isValidElement(node)) {
    if (typeof node.type !== "string") return node;
    const element = asMotionTextNode(node);
    const children = element.props.children;
    const mappedChildren = mapTextLeaves(children, leafIndex, leaves, tokens);
    return cloneElement(element, { children: mappedChildren });
  }
  return node;
}

function renderTextLeaf(
  leaf: { text: string; start: number; end: number } | undefined,
  tokens: MotionTextToken[],
): ReactNode {
  if (!leaf) return null;
  const parts: ReactNode[] = [];
  for (const token of tokens) {
    const start = Math.max(leaf.start, token.start);
    const end = Math.min(leaf.end, token.end);
    if (start >= end) continue;
    const text = leaf.text.slice(start - leaf.start, end - leaf.start);
    if (!token.animated) {
      parts.push(text);
      continue;
    }
    parts.push(
      <span
        className="agent-native-motion-text-unit"
        data-agent-native-motion-text-unit={token.index}
        key={`${token.index}-${start}`}
      >
        {text}
      </span>,
    );
  }
  return parts;
}

function countTextLeaves(node: ReactNode): number {
  if (typeof node === "string" || typeof node === "number") return 1;
  if (Array.isArray(node))
    return node.reduce((sum, child) => sum + countTextLeaves(child), 0);
  if (isValidElement(node)) {
    return countTextLeaves(asMotionTextNode(node).props.children);
  }
  return 0;
}

function renderParagraphs(
  node: ReactNode,
  nextUnitIndex: { current: number },
): ReactNode {
  if (isValidElement(node) && typeof node.type === "string") {
    const element = asMotionTextNode(node);
    if (PARAGRAPH_TAGS.has(node.type)) {
      const index = nextUnitIndex.current++;
      return cloneElement(element, {
        "data-agent-native-motion-text-unit": index,
      });
    }
    if (Array.isArray(element.props.children)) {
      let foundElement = false;
      const children = element.props.children.map((child: ReactNode) => {
        if (
          isValidElement(child) &&
          typeof child.type === "string" &&
          PARAGRAPH_TAGS.has(child.type)
        ) {
          foundElement = true;
          return renderParagraphs(child, nextUnitIndex);
        }
        return child;
      });
      if (foundElement) return cloneElement(element, { children });
    }
    if (
      isValidElement(element.props.children) &&
      typeof element.props.children.type === "string" &&
      PARAGRAPH_TAGS.has(element.props.children.type)
    ) {
      return cloneElement(element, {
        children: renderParagraphs(element.props.children, nextUnitIndex),
      });
    }
    if (
      typeof element.props.children === "string" &&
      element.props.children.length > 0
    ) {
      const index = nextUnitIndex.current++;
      return cloneElement(element, {
        "data-agent-native-motion-text-unit": index,
      });
    }
  }
  return node;
}

function asMotionTextNode(node: ReactElement): MotionTextNode {
  return node as MotionTextNode;
}

function resolveMotionUnits(
  host: HTMLElement,
  animation: MotionTextAnimation,
): Array<{ element: HTMLElement; index: number }> {
  if (animation.unit === "paragraph") {
    const hostTag = host.tagName.toLowerCase();
    if (PARAGRAPH_TAGS.has(hostTag)) return [{ element: host, index: 0 }];
    const children = Array.from(host.children) as HTMLElement[];
    if (
      children.length &&
      children.every((child) => PARAGRAPH_TAGS.has(child.tagName.toLowerCase()))
    ) {
      return children.map((element, index) => ({ element, index }));
    }
    return [{ element: host, index: 0 }];
  }
  const units = Array.from(
    host.querySelectorAll<HTMLElement>("[data-agent-native-motion-text-unit]"),
  );
  if (animation.unit === "line") {
    const lineTops: number[] = [];
    return units.map((element) => {
      const top = element.getBoundingClientRect().top;
      let index = lineTops.findIndex(
        (existing) => Math.abs(existing - top) < 0.5,
      );
      if (index < 0) {
        index = lineTops.length;
        lineTops.push(top);
      }
      return { element, index };
    });
  }
  return units.map((element) => ({
    element,
    index: Number(element.getAttribute("data-agent-native-motion-text-unit")),
  }));
}

interface MotionPreviewMessage {
  type: "motion-preview" | "motion-preview-clear";
  t?: number;
  durationMs?: number;
}

function isMotionPreviewMessage(value: unknown): value is MotionPreviewMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.type === "string" &&
    PREVIEW_MESSAGE_TYPES.has(message.type as MotionPreviewMessage["type"])
  );
}
