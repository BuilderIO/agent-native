// Shared test-case data for before/after SVG diffing. Not imported by the
// modules under test -- just literal data duplicated into both runner scripts.
export const THEMES = {
  dark: {
    background: "#09090b",
    gridColor: "#27272a",
    tickColor: "#a1a1aa",
    titleColor: "#fafafa",
    labelColor: "#fafafa",
  },
  light: {
    background: "#ffffff",
    gridColor: "#d4d4d8",
    tickColor: "#71717a",
    titleColor: "#09090b",
    labelColor: "#09090b",
  },
} as const;

export const PALETTES = {
  dark: [
    "#00B5FF",
    "#48FFE4",
    "#22c55e",
    "#f59e0b",
    "#0ea5e9",
    "#ef4444",
    "#14b8a6",
    "#f97316",
  ],
  light: [
    "#0284C7",
    "#0D9488",
    "#16a34a",
    "#d97706",
    "#0369a1",
    "#dc2626",
    "#0f766e",
    "#ea580c",
  ],
} as const;

const labels6 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];

const manySeries = Array.from({ length: 11 }, (_, i) => ({
  label: `Series ${i + 1}`,
  data: labels6.map((_, j) => (i + 1) * 3 + j * 2),
}));

export function buildCases() {
  const cases: Array<{
    name: string;
    args: {
      title: string;
      subtitle: string;
      labels: string[];
      datasets: Array<{ label: string; data: number[]; color?: string }>;
      type: "bar" | "line" | "area";
      width: number;
      height: number;
      theme: (typeof THEMES)["dark" | "light"];
      palette: readonly string[];
      primaryColor: string;
      stacked: boolean;
    };
  }> = [];

  const baseDatasets3 = [
    { label: "A", data: [10, 20, 30, 5, 15, 25] },
    { label: "B", data: [5, 15, 10, 20, 8, 12] },
    { label: "C", data: [8, 3, 12, 18, 6, 9] },
  ];

  for (const themeName of ["dark", "light"] as const) {
    const theme = THEMES[themeName];
    const palette = PALETTES[themeName];

    cases.push({
      name: `bar-unstacked-${themeName}`,
      args: {
        title: "Revenue & Growth <Test>",
        subtitle: "Monthly breakdown",
        labels: labels6,
        datasets: baseDatasets3,
        type: "bar",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: false,
      },
    });

    cases.push({
      name: `bar-stacked-${themeName}`,
      args: {
        title: "Stacked Revenue",
        subtitle: "",
        labels: labels6,
        datasets: baseDatasets3,
        type: "bar",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: true,
      },
    });

    cases.push({
      name: `line-${themeName}`,
      args: {
        title: "Line Chart",
        subtitle: "Trend",
        labels: labels6,
        datasets: baseDatasets3,
        type: "line",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: false,
      },
    });

    cases.push({
      name: `area-${themeName}`,
      args: {
        title: "Area Chart",
        subtitle: "Trend",
        labels: labels6,
        datasets: baseDatasets3,
        type: "area",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: false,
      },
    });

    cases.push({
      name: `many-series-more-than-palette-${themeName}`,
      args: {
        title: "Many Series",
        subtitle: "",
        labels: labels6,
        datasets: manySeries,
        type: "bar",
        width: 900,
        height: 450,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: true,
      },
    });

    cases.push({
      name: `single-dataset-empty-${themeName}`,
      args: {
        title: "Empty",
        subtitle: "",
        labels: labels6,
        datasets: [],
        type: "bar",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: false,
      },
    });

    cases.push({
      name: `custom-color-per-series-${themeName}`,
      args: {
        title: "Custom Colors",
        subtitle: "",
        labels: labels6,
        datasets: [
          { label: "A", data: [1, 2, 3, 4, 5, 6], color: "#123abc" },
          { label: "B", data: [6, 5, 4, 3, 2, 1] },
        ],
        type: "bar",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: false,
      },
    });

    cases.push({
      name: `invalid-primary-color-${themeName}`,
      args: {
        title: "Invalid Color",
        subtitle: "",
        labels: labels6,
        datasets: [{ label: "A", data: [1, 2, 3, 4, 5, 6], color: "not-a-color" }],
        type: "bar",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: "not-a-color",
        stacked: false,
      },
    });

    cases.push({
      name: `negative-values-${themeName}`,
      args: {
        title: "Negative Values",
        subtitle: "",
        labels: labels6,
        datasets: [{ label: "A", data: [-10, 20, -5, 15, -8, 12] }],
        type: "line",
        width: 800,
        height: 400,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: false,
      },
    });

    cases.push({
      name: `many-labels-${themeName}`,
      args: {
        title: "Many Labels",
        subtitle: "",
        labels: Array.from({ length: 20 }, (_, i) => `Label-${i}-with-long-name`),
        datasets: [
          {
            label: "A",
            data: Array.from({ length: 20 }, (_, i) => i * 3),
          },
        ],
        type: "bar",
        width: 1000,
        height: 500,
        theme,
        palette,
        primaryColor: palette[0],
        stacked: false,
      },
    });
  }

  return cases;
}
