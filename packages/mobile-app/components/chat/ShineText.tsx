import { useEffect, useId, useState } from "react";
import { Platform, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Text as SvgText,
} from "react-native-svg";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

const FONT_FAMILY = Platform.select({
  android: "sans-serif",
  default: "System",
});

/**
 * Native equivalent of the web agent-thinking-shine text treatment. The
 * invisible text keeps native layout and accessibility authoritative while
 * SVG clips the moving highlight to the same glyphs.
 */
export function ShineText({
  children,
  className,
  active = true,
}: {
  children: string;
  className?: string;
  active?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const gradientId = `mobile-chat-shine-${useId().replace(/:/g, "")}`;
  const progress = useSharedValue(-75);

  useEffect(() => {
    if (!active) return;
    progress.set(withRepeat(withTiming(100, { duration: 2600 }), -1, false));
  }, [active, progress]);

  const animatedProps = useAnimatedProps(() => ({
    x1: `${progress.get()}%`,
    x2: `${progress.get() + 75}%`,
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  if (!active) {
    return (
      <Text className={className ?? "text-status-gray text-[13px] font-medium"}>
        {children}
      </Text>
    );
  }

  return (
    <View onLayout={onLayout} accessible accessibilityLabel={children}>
      <Text
        className={className ?? "text-status-gray text-[13px] font-medium"}
        style={{ opacity: width > 0 ? 0 : 1 }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {children}
      </Text>
      {width > 0 ? (
        <Svg
          pointerEvents="none"
          width={width}
          height={18}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <Defs>
            <AnimatedLinearGradient
              id={gradientId}
              y1="0%"
              y2="0%"
              animatedProps={animatedProps}
            >
              <Stop offset="0%" stopColor="#8e8e96" />
              <Stop offset="36%" stopColor="#8e8e96" />
              <Stop offset="50%" stopColor="#fafafa" />
              <Stop offset="64%" stopColor="#9d9da4" />
              <Stop offset="100%" stopColor="#8e8e96" />
            </AnimatedLinearGradient>
          </Defs>
          <SvgText
            x="0"
            y="13"
            fill={`url(#${gradientId})`}
            fontFamily={FONT_FAMILY}
            fontSize={13}
            fontWeight="500"
          >
            {children}
          </SvgText>
        </Svg>
      ) : null}
    </View>
  );
}
