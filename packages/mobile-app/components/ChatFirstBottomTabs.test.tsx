import { createElement, type ComponentProps, type ReactNode } from "react";
import { expect, it, vi } from "vitest";

const rendered = vi.hoisted(() => ({ styles: [] as unknown[] }));
vi.mock("react-native", () => {
  const Box = ({
    children,
    style,
    accessibilityLabel,
  }: {
    children?: ReactNode;
    style?: unknown;
    accessibilityLabel?: string;
  }) => {
    rendered.styles.push(style);
    return createElement("div", { "aria-label": accessibilityLabel }, children);
  };
  return {
    View: Box,
    Text: Box,
    Pressable: Box,
    StyleSheet: {
      absoluteFill: {
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      },
      hairlineWidth: 1,
    },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
});
vi.mock("@tabler/icons-react-native", () => ({
  IconMessageCircle: () => null,
  IconPlus: () => null,
  IconSettings: () => null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    Extrapolation: { CLAMP: "clamp" },
    interpolate: (_value: number, _input: number[], output: number[]) =>
      output[0],
    useAnimatedStyle: (style: () => object) => style(),
    useSharedValue: (value: number) => ({ value }),
    withSpring: (value: number) => value,
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 34 }),
}));
vi.mock("@/components/AppCard", () => ({ AppIcon: () => null }));
vi.mock("@/components/AppLauncherMenu", () => ({
  AppLauncherMenu: () => null,
}));
vi.mock("@/lib/mobile-app-navigation", () => ({
  getAppRoute: (id: string) => `/tab-app/${id}`,
  getCurrentMobileTabRouteName: () => "chat",
  activateMobileTab: vi.fn(),
}));
vi.mock("@/lib/mobile-colors", () => ({
  useMobileThemeColors: () => ({
    background: "white",
    card: "white",
    foreground: "black",
    mutedForeground: "gray",
    border: "gray",
    secondary: "gray",
    theme: "light",
  }),
}));
vi.mock("@/lib/mobile-tab-layout", () => ({
  useMobileTabLayout: () => ({ selectedAppIds: [] }),
}));
vi.mock("@/lib/navigation", () => ({ navigateToPath: vi.fn() }));
vi.mock("@/lib/use-apps", () => ({ useApps: () => ({ enabledApps: [] }) }));
import ChatFirstBottomTabs from "./ChatFirstBottomTabs";
const { renderToString } = await vi.importActual<{
  renderToString(node: ReactNode): string;
}>("react-dom/server");

it("keeps navigation visible without painting a fade or shadow above it", () => {
  rendered.styles = [];
  const props = {
    state: { routes: [{ key: "chat", name: "chat" }], index: 0 },
    emitter: { emit: vi.fn() },
    navigateToTab: vi.fn(),
  } as unknown as ComponentProps<typeof ChatFirstBottomTabs>;
  const html = renderToString(createElement(ChatFirstBottomTabs, props));
  const styles = rendered.styles
    .flat(Infinity)
    .filter(
      (style): style is Record<string, unknown> =>
        Boolean(style) && typeof style === "object",
    );
  expect(html).toContain('aria-label="Primary navigation"');
  expect(html).toContain('aria-label="All apps"');
  expect(
    styles.some(
      (style) =>
        style.experimental_backgroundImage ||
        style.backgroundImage ||
        style.boxShadow ||
        style.shadowOpacity,
    ),
  ).toBe(false);
});
