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

import { useMobileThemeColors } from "@/lib/mobile-colors";

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

export function TabBarBackgroundFade({ style, ...props }: ViewProps) {
  const { background } = useMobileThemeColors();
  return (
    <View
      {...props}
      pointerEvents="none"
      style={[
        style,
        {
          experimental_backgroundImage: `linear-gradient(to top, ${background} 0%, transparent 100%)`,
        },
      ]}
    />
  );
}
