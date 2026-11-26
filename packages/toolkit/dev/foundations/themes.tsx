import {
  DEFAULT_PALETTE_INPUT,
  STATUS_ROLES,
  THEMES,
  type ThemeDefinition,
} from "@agent-native/design-system";

import { Badge } from "../../src/ui/base-ui/badge.js";
import { Button } from "../../src/ui/base-ui/button.js";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../src/ui/base-ui/segmented-control.js";
import { lookup, type Stage, useStage } from "./live.js";
import { Code, Page, Prose, Section, Swatch } from "./page.js";

const STEPS = Array.from({ length: 12 }, (_, index) => index + 1);

const SOURCES = [
  { slot: "primary", scale: "Brand" },
  { slot: "muted-foreground", scale: "Gray" },
  { slot: "destructive", scale: "Danger" },
  { slot: "background", scale: "Background" },
] as const;

interface Source {
  scale: string;
  swatch: string;
  value: string;
}

function sources(theme: ThemeDefinition, stage: Stage): Source[] {
  if (theme.readsScales) {
    return [
      {
        scale: "Brand",
        swatch: DEFAULT_PALETTE_INPUT.brand,
        value: DEFAULT_PALETTE_INPUT.brand,
      },
      {
        scale: "Gray",
        swatch: DEFAULT_PALETTE_INPUT.gray,
        value: DEFAULT_PALETTE_INPUT.gray,
      },
      {
        scale: "Background",
        swatch: DEFAULT_PALETTE_INPUT.background[stage.appearance],
        value: DEFAULT_PALETTE_INPUT.background[stage.appearance],
      },
    ];
  }
  const values = theme[stage.appearance];
  return SOURCES.map(({ slot, scale }) => ({
    scale,
    swatch: `hsl(var(--theme-${slot}))`,
    value: lookup(values, `--theme-${slot}`) ?? "Not set",
  }));
}

function ThemeCard({ theme, stage }: { theme: ThemeDefinition; stage: Stage }) {
  return (
    <li
      data-app-theme={theme.name}
      className={`${stage.appearance} flex flex-col gap-4 rounded-card border border-line bg-surface-canvas p-4 text-fg`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-3 font-semibold">{theme.label}</h3>
        <Code>{theme.name}</Code>
        {theme.isDefault ? <Badge color="gray">Default</Badge> : null}
        {stage.theme === theme.name ? (
          <Badge variant="soft">Current</Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-2">
        {sources(theme, stage).map((source) => (
          <div
            key={source.scale}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2"
          >
            <dt className="col-start-2 text-1 text-fg-muted">{source.scale}</dt>
            <dd className="contents">
              <span className="col-start-1 row-span-2 row-start-1">
                <Swatch color={source.swatch} size="sm" />
              </span>
              <span className="col-start-2 truncate">
                <Code>{source.value}</Code>
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <ol aria-label="Brand scale" className="grid grid-cols-12 gap-0.5">
        {STEPS.map((step) => (
          <li key={step} className="flex flex-col items-center gap-0.5">
            <span
              aria-hidden="true"
              className="block h-6 w-full rounded-control"
              style={{ background: `var(--brand-${step})` }}
            />
            <span className="text-[10px] text-fg-muted">{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm">Save</Button>
        <Button size="sm" variant="soft">
          Share
        </Button>
        <Button size="sm" variant="outline" color="gray">
          Cancel
        </Button>
        <Badge>Beta</Badge>
        <Badge color="success">Live</Badge>
        <Badge color="danger">Failed</Badge>
      </div>
      <SegmentedControl
        aria-label={`${theme.label} sample view`}
        defaultValue="list"
        size="sm"
        className="self-start"
      >
        <SegmentedControlItem value="list">List</SegmentedControlItem>
        <SegmentedControlItem value="board">Board</SegmentedControlItem>
      </SegmentedControl>
    </li>
  );
}

function AllThemes() {
  const stage = useStage();
  if (stage === null) return null;
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {THEMES.map((theme) => (
        <ThemeCard key={theme.name} theme={theme} stage={stage} />
      ))}
    </ul>
  );
}

export function ThemesPage() {
  return (
    <Page
      title="Themes"
      intro={`${THEMES.length} themes: the Agent-Native default, one per app, and the baseline. An app picks its theme with data-app-theme, and every sample below renders inside its own theme in the toolbar's appearance.`}
    >
      <Section title="How themes make their colors">
        <Prose>
          Each app theme generates its scales from its own colors: brand from
          its primary, gray from its muted text over its background, and danger
          from its destructive color. The other status scales (
          {STATUS_ROLES.filter((role) => role !== "danger").join(", ")}) come
          from the default palette. Roles read the theme's colors, and the
          parts' accent steps read the generated scales. The baseline theme maps
          its roles straight onto the default scales.
        </Prose>
      </Section>
      <Section title="All themes">
        <AllThemes />
      </Section>
    </Page>
  );
}
