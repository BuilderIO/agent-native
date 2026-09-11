import { createContext, useContext, useEffect, useRef, useState } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

// Global cache for tracking already-seen content length per message to avoid re-animating on remount
const seenMessageTextLengths = new Map<string, number>();

export function getSeenTextLength(messageId: string): number {
  return seenMessageTextLengths.get(messageId) ?? 0;
}

export function updateSeenTextLength(messageId: string, length: number) {
  const current = seenMessageTextLengths.get(messageId) ?? 0;
  if (length > current) {
    seenMessageTextLengths.set(messageId, length);
  }
}

// Contexts
export const MessageContext = createContext<{
  isStreaming: boolean;
  messageId: string;
}>({
  isStreaming: false,
  messageId: "",
});

export const DisableFadeContext = createContext<boolean>(false);

export function useDisableFadeContext() {
  return useContext(DisableFadeContext);
}

// High-performance math-based stagger scheduler running entirely on UI thread via Reanimated delays
let nextAnimationStartTime = 0;
let batchCount = 0;
const STAGGER_DELAY_MS = 32;

function getStaggeredDelay(): number {
  const now = Date.now();
  if (nextAnimationStartTime < now) {
    nextAnimationStartTime = now;
    batchCount = 0;
  }
  const delay = nextAnimationStartTime - now;

  // Calculate queue length (number of scheduled intervals)
  const queueLength = Math.max(0, Math.floor(delay / STAGGER_DELAY_MS));

  // Determine dynamic batch size
  let currentBatchSize = 2;
  if (queueLength > 10) {
    currentBatchSize = Math.max(2, Math.floor(queueLength / 5) * 2);
  }

  batchCount++;
  if (batchCount >= currentBatchSize) {
    batchCount = 0;
    nextAnimationStartTime += STAGGER_DELAY_MS;
  }
  return delay;
}

interface FadeInWithDelayProps {
  children: React.ReactNode;
  delay: number;
  Component?: any;
}

export function FadeInWithDelay({
  children,
  delay,
  Component = Animated.View,
}: FadeInWithDelayProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.set(withDelay(delay, withTiming(1, { duration: 500 })));
  }, [delay, opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.get(),
    };
  });

  return <Component style={animatedStyle}>{children}</Component>;
}

export function FadeInStaggeredIfStreaming({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isStreaming } = useContext(MessageContext);
  const isFadeDisabled = useDisableFadeContext();

  const [shouldAnimate] = useState(!isFadeDisabled && isStreaming);
  const delay = useRef(shouldAnimate ? getStaggeredDelay() : 0).current;

  return shouldAnimate ? (
    <FadeInWithDelay delay={delay}>{children}</FadeInWithDelay>
  ) : (
    <>{children}</>
  );
}

export function TextFadeInStaggeredIfStreaming({
  children,
  startIndex = 0,
}: {
  children: React.ReactNode;
  startIndex?: number;
}) {
  const { isStreaming, messageId } = useContext(MessageContext);
  const isFadeDisabled = useDisableFadeContext();

  // Determine shouldAnimate once on mount
  const [shouldAnimate] = useState(!isFadeDisabled && isStreaming);

  if (shouldAnimate && typeof children === "string") {
    return (
      <AnimatedFadeInText
        text={children}
        messageId={messageId}
        startIndex={startIndex}
      />
    );
  }

  return <>{children}</>;
}

function AnimatedFadeInText({
  text,
  messageId,
  startIndex = 0,
}: {
  text: string;
  messageId: string;
  startIndex?: number;
}) {
  const chunks = text.split(" ");
  let currentOffset = startIndex;
  return (
    <>
      {chunks.map((chunk, i) => {
        const wordOffset = currentOffset;
        currentOffset += chunk.length + 1; // chunk length + space
        return (
          <TextFadeInStaggered
            key={i}
            text={chunk + (i < chunks.length - 1 ? " " : "")}
            messageId={messageId}
            offset={wordOffset}
          />
        );
      })}
    </>
  );
}

function TextFadeInStaggered({
  text,
  messageId,
  offset,
}: {
  text: string;
  messageId: string;
  offset: number;
}) {
  const isFadeDisabled =
    useDisableFadeContext() ||
    (messageId && offset < getSeenTextLength(messageId));

  const [shouldAnimate] = useState(!isFadeDisabled);
  const delay = useRef(shouldAnimate ? getStaggeredDelay() : 0).current;

  useEffect(() => {
    if (messageId) {
      updateSeenTextLength(messageId, offset + text.length);
    }
  }, [messageId, offset, text.length]);

  return shouldAnimate ? (
    <FadeInWithDelay delay={delay} Component={Animated.Text}>
      {text}
    </FadeInWithDelay>
  ) : (
    <>{text}</>
  );
}
