import { BlurView } from "expo-blur";
import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";
import { View, type ViewProps } from "react-native";
import {
  useAnimatedScrollHandler,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";

const MINIMIZE_SPRING = { duration: 380, dampingRatio: 1 };

type MinimizeState = {
  progress: SharedValue<number>;
  target: SharedValue<number>;
};

const MinimizeContext = createContext<MinimizeState | null>(null);

export function TabBarMinimizeProvider({ children }: PropsWithChildren) {
  const progress = useSharedValue(0);
  const target = useSharedValue(0);
  const state = useMemo(() => ({ progress, target }), [progress, target]);
  return (
    <MinimizeContext.Provider value={state}>
      {children}
    </MinimizeContext.Provider>
  );
}

function useMinimizeState(): MinimizeState {
  const shared = useContext(MinimizeContext);
  const progress = useSharedValue(0);
  const target = useSharedValue(0);
  const local = useMemo(() => ({ progress, target }), [progress, target]);
  return shared ?? local;
}

export function useTabBarMinimized(): SharedValue<number> {
  return useMinimizeState().progress;
}

function setMinimized(state: MinimizeState, next: 0 | 1) {
  "worklet";
  if (state.target.value === next) return;
  state.target.value = next;
  state.progress.value = withSpring(next, MINIMIZE_SPRING);
}

export function useMinimizeOnScroll() {
  const state = useMinimizeState();
  const previousY = useSharedValue(0);

  return useAnimatedScrollHandler({
    onScroll: (event) => {
      const maxY = Math.max(
        event.contentSize.height - event.layoutMeasurement.height,
        0,
      );
      const y = Math.min(Math.max(event.contentOffset.y, 0), maxY);
      const dy = y - previousY.value;
      previousY.value = y;

      if (y < 24) setMinimized(state, 0);
      else if (dy > 3) setMinimized(state, 1);
      else if (dy < -3) setMinimized(state, 0);
    },
  });
}

type ProgressiveBlurProps = ViewProps & {
  intensity?: number;
  direction?: "top" | "bottom";
};

const BLUR_HEIGHTS = [
  "100%",
  "88%",
  "76%",
  "64%",
  "54%",
  "44%",
  "36%",
  "28%",
  "22%",
  "16%",
] as const;

export function ProgressiveBlur({
  style,
  intensity = 5,
  direction = "top",
  ...props
}: ProgressiveBlurProps) {
  const anchor = direction === "top" ? { top: 0 } : { bottom: 0 };
  return (
    <View pointerEvents="none" style={style} {...props}>
      {BLUR_HEIGHTS.map((height) => (
        <BlurView
          intensity={intensity}
          key={height}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height,
            ...anchor,
          }}
          tint="dark"
        />
      ))}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          experimental_backgroundImage: `linear-gradient(to ${direction === "top" ? "bottom" : "top"}, rgba(0,0,0,0.70) 0%, rgba(0,0,0,0.32) 42%, rgba(0,0,0,0.08) 68%, rgba(0,0,0,0) 88%)`,
        }}
      />
    </View>
  );
}
