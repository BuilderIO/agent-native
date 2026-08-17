import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ModalSafeAreaProvider } from "@/components/uniwind-interop";

export const MOBILE_SHEET_CLOSE_DURATION_MS = 150;

type MobileSheetSide = "bottom" | "left";
type MobileSheetMotion = "popover" | "sheet";

export function MobileSheet({
  visible,
  onClose,
  children,
  side = "bottom",
  motion = "popover",
  motionOffset,
  contentClassName = "",
  contentStyle,
  overlayClassName = "bg-black/45",
  accessibilityLabel = "Dismiss sheet",
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  side?: MobileSheetSide;
  motion?: MobileSheetMotion;
  /** Positive closed-state travel distance. Left sheets travel in from -x. */
  motionOffset?: number;
  contentClassName?: string;
  contentStyle?: StyleProp<ViewStyle>;
  overlayClassName?: string;
  accessibilityLabel?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const backdropOpacity = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const contentScale = useSharedValue(motion === "popover" ? 0.95 : 1);
  const contentOffset = useSharedValue(
    side === "left"
      ? -(motionOffset ?? 96)
      : (motionOffset ?? (motion === "popover" ? 10 : 48)),
  );

  const duration = reducedMotion ? 0 : undefined;
  const openDuration = duration ?? (motion === "popover" ? 150 : 260);
  const closeDuration = duration ?? MOBILE_SHEET_CLOSE_DURATION_MS;

  useEffect(() => {
    cancelAnimation(backdropOpacity);
    cancelAnimation(contentOpacity);
    cancelAnimation(contentScale);
    cancelAnimation(contentOffset);

    const closedOffset =
      side === "left"
        ? -(motionOffset ?? 96)
        : (motionOffset ?? (motion === "popover" ? 10 : 48));

    if (visible) {
      setMounted(true);
      backdropOpacity.set(0);
      contentOpacity.set(0);
      contentScale.set(motion === "popover" ? 0.95 : 1);
      contentOffset.set(closedOffset);

      const frame = requestAnimationFrame(() => {
        backdropOpacity.set(
          withTiming(1, {
            duration: openDuration,
            easing: Easing.out(Easing.cubic),
          }),
        );
        contentOpacity.set(
          withTiming(1, {
            duration: openDuration,
            easing: Easing.out(Easing.cubic),
          }),
        );
        contentScale.set(
          withTiming(1, {
            duration: openDuration,
            easing: Easing.out(Easing.cubic),
          }),
        );
        contentOffset.set(
          withTiming(0, {
            duration: openDuration,
            easing: Easing.out(Easing.cubic),
          }),
        );
      });

      return () => cancelAnimationFrame(frame);
    }

    backdropOpacity.set(
      withTiming(0, {
        duration: closeDuration,
        easing: Easing.out(Easing.cubic),
      }),
    );
    contentOpacity.set(
      withTiming(0, {
        duration: closeDuration,
        easing: Easing.out(Easing.cubic),
      }),
    );
    contentScale.set(
      withTiming(motion === "popover" ? 0.95 : 1, {
        duration: closeDuration,
        easing: Easing.out(Easing.cubic),
      }),
    );
    contentOffset.set(
      withTiming(
        closedOffset,
        {
          duration: closeDuration,
          easing: Easing.out(Easing.cubic),
        },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      ),
    );
  }, [
    backdropOpacity,
    closeDuration,
    contentOffset,
    contentOpacity,
    contentScale,
    motion,
    motionOffset,
    openDuration,
    side,
    visible,
  ]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.get(),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.get(),
    transform:
      side === "left"
        ? [{ translateX: contentOffset.get() }]
        : [
            { translateY: contentOffset.get() },
            ...(motion === "popover" ? [{ scale: contentScale.get() }] : []),
          ],
  }));

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      animationType="none"
      transparent
      onRequestClose={onClose}
    >
      <ModalSafeAreaProvider style={{ flex: 1 }}>
        <View className="flex-1">
          <Animated.View
            pointerEvents="none"
            className={`absolute inset-0 ${overlayClassName}`}
            style={backdropStyle}
          />

          {side === "left" ? (
            <View className="flex-1 flex-row">
              <Animated.View
                className={contentClassName}
                style={[sheetStyle, contentStyle]}
              >
                {children}
              </Animated.View>
              <Pressable
                className="flex-1"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
              />
            </View>
          ) : (
            <View className="flex-1 justify-end">
              <Pressable
                className="absolute inset-0"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
              />
              <Animated.View
                className={contentClassName}
                style={[sheetStyle, contentStyle]}
              >
                {children}
              </Animated.View>
            </View>
          )}
        </View>
      </ModalSafeAreaProvider>
    </Modal>
  );
}
