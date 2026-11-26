import {
  type AppThemeName,
  createPalette,
  DENSITIES,
  paletteCss,
  RADIUS_PRESETS,
  THEMES,
} from "@agent-native/design-system";
import type { Decorator, Preview } from "@storybook/react-vite";
import * as React from "react";

import { ThemeProvider } from "../src/ui/base-ui/theme-provider.js";
import { PanelSpacing } from "./panel-spacing.js";

import "./storybook.css";

const BRANDS: Readonly<Record<string, string | null>> = {
  none: null,
  indigo: "#5b5bd6",
  red: "#e5484d",
  green: "#30a46c",
  orange: "#f76b15",
  cyan: "#00a2c7",
};

const PALETTE_ID = "storybook";
const GRAY = "#8d8d8d";

function PaletteStyle({ brand }: { brand: string | null }) {
  const css = React.useMemo(
    () =>
      brand
        ? paletteCss(createPalette({ brand, gray: GRAY }), { id: PALETTE_ID })
        : "",
    [brand],
  );
  return css ? <style data-storybook-palette="">{css}</style> : null;
}

function globalString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isAppTheme(value: unknown): value is AppThemeName {
  return THEMES.some((theme) => theme.name === value);
}

const withStage: Decorator = (
  Story,
  { globals, parameters, viewMode, title },
) => {
  const theme = isAppTheme(globals.theme) ? globals.theme : "agent-native";
  const appearance = globals.appearance === "dark" ? "dark" : "light";
  const density =
    DENSITIES.find((value) => value === globals.density) ?? "default";
  const radius = RADIUS_PRESETS.find((value) => value === globals.radius);
  const corners = globals.corners === "squircle" ? "squircle" : "round";
  const brandKey = globalString(globals.palette, "none");
  const spacing = parameters.stage === "editor" && globals.spacing === "on";
  const brand = BRANDS[brandKey] ?? null;
  return (
    <>
      <PaletteStyle brand={brand} />
      <ThemeProvider
        render={
          viewMode === "story" && title.startsWith("Components/") ? (
            <main />
          ) : undefined
        }
        appearance={appearance}
        dir={globals.direction === "rtl" ? "rtl" : "ltr"}
        className={`${viewMode === "docs" ? "" : "min-h-screen"} bg-surface-canvas text-fg`}
        appTheme={theme}
        density={density}
        radius={radius}
        corners={corners}
        palette={brand ? PALETTE_ID : undefined}
        data-storybook-stage=""
      >
        <div
          style={spacing ? { position: "relative" } : undefined}
          className={
            parameters.stage === "editor"
              ? undefined
              : "mx-auto max-w-[1120px] px-8 py-10"
          }
        >
          <Story />
          {spacing && <PanelSpacing />}
        </div>
      </ThemeProvider>
    </>
  );
};

type GlobalType = NonNullable<Preview["globalTypes"]>[string];
type ToolbarIcon = NonNullable<NonNullable<GlobalType["toolbar"]>["icon"]>;

function toolbar(
  title: string,
  icon: ToolbarIcon,
  items: readonly string[],
  defaultValue: string,
): GlobalType {
  return {
    description: title,
    defaultValue,
    toolbar: {
      title,
      icon,
      items: items.map((value) => ({ value, title: value })),
      dynamicTitle: true,
    },
  };
}

const ReferencePage = React.lazy(() => import("./reference-page.js"));

const preview: Preview = {
  decorators: [withStage],
  globalTypes: {
    spacing: {
      description: "Measure the Design panel grid",
      defaultValue: "off",
      toolbar: { title: "Panel spacing", icon: "grid", items: ["off", "on"] },
    },
    theme: toolbar(
      "Theme",
      "paintbrush",
      THEMES.map((theme) => theme.name),
      "agent-native",
    ),
    appearance: toolbar("Appearance", "contrast", ["light", "dark"], "light"),
    direction: toolbar("Direction", "transfer", ["ltr", "rtl"], "ltr"),
    density: toolbar("Density", "component", DENSITIES, "default"),
    radius: toolbar(
      "Radius",
      "circlehollow",
      ["theme", ...RADIUS_PRESETS],
      "theme",
    ),
    corners: toolbar("Corners", "outline", ["round", "squircle"], "round"),
    palette: toolbar("Palette", "starhollow", Object.keys(BRANDS), "none"),
  },
  parameters: {
    docs: {
      page: () => (
        <React.Suspense>
          <ReferencePage />
        </React.Suspense>
      ),
    },
    a11y: {
      test: "error",
      context: { exclude: ["[data-base-ui-focus-guard]"] },
    },
    backgrounds: { disable: true },
    controls: { expanded: true },
    options: {
      storySort: {
        method: "alphabetical",
        order: [
          "Introduction",
          "Migration status",
          "Foundations",
          [
            "Color",
            "Typography",
            "Space and density",
            "Sizing",
            "Radius and shape",
            "Elevation",
            "Motion",
            "Themes",
          ],
          "Typography",
          ["Text", "Heading", "Code", "Kbd", "Blockquote"],
          "Components",
          ["Overview", "*"],
          "Patterns",
        ],
      },
    },
  },
  tags: ["autodocs"],
};

export default preview;
