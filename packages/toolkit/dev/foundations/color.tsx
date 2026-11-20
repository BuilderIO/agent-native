import {
  type Color,
  COLOR_SCALES,
  COLORS,
  getTheme,
  ROLE_GROUPS,
  type TokenName,
} from "@agent-native/design-system";
import * as React from "react";

import { Badge } from "../../src/ui/base-ui/badge.js";
import { Button } from "../../src/ui/base-ui/button.js";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "../../src/ui/base-ui/segmented-control.js";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "../../src/ui/base-ui/tabs.js";
import {
  contrastRatio,
  lookup,
  type Resolved,
  useResolved,
  useStage,
  WCAG_AA_TEXT,
} from "./live.js";
import {
  Cell,
  Code,
  Page,
  Prose,
  Row,
  Section,
  Swatch,
  Table,
  TokenValue,
  Value,
} from "./page.js";

const STEPS = Array.from({ length: 12 }, (_, index) => index + 1);

const STEP_RANGES = [
  { from: 1, to: 2, use: "Backgrounds" },
  { from: 3, to: 5, use: "Interactive fills" },
  { from: 6, to: 8, use: "Borders" },
  { from: 9, to: 10, use: "Solid fills" },
  { from: 11, to: 12, use: "Text" },
] as const;

const STEP_USES: Readonly<Record<number, string>> = {
  1: "App background",
  2: "Subtle background",
  3: "Control background",
  4: "Hovered control background",
  5: "Pressed or selected control background",
  6: "Subtle borders and separators",
  7: "Control borders",
  8: "Hovered borders and focus rings",
  9: "Solid fill, the purest step",
  10: "Hovered solid fill",
  11: "Low-contrast text",
  12: "High-contrast text",
};

const SCALES = COLORS.map((color) => ({ color, scale: COLOR_SCALES[color] }));

const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const scaleTokens = (scale: string) => [
  ...STEPS.map((step) => `--${scale}-${step}`),
  ...STEPS.map((step) => `--${scale}-a${step}`),
];

function ColorValue({
  token,
  resolved,
}: {
  token: string;
  resolved: Resolved | undefined;
}) {
  return (
    <span className="flex items-center gap-3">
      <Swatch color={`var(${token})`} />
      <TokenValue token={token} resolved={resolved} />
    </span>
  );
}

function Overview() {
  const tokens = SCALES.flatMap(({ scale }) =>
    STEPS.map((step) => `--${scale}-${step}`),
  );
  const values = useResolved(tokens, "color");
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">Every scale's solid steps 1 to 12</caption>
        <thead>
          <tr>
            <td className="w-24" />
            {STEP_RANGES.map((range) => (
              <th
                key={range.use}
                scope="colgroup"
                colSpan={range.to - range.from + 1}
                className="border-b border-line px-0.5 pb-1 text-1 font-medium text-fg-muted"
              >
                {range.use}
              </th>
            ))}
          </tr>
          <tr>
            <td />
            {STEPS.map((step) => (
              <th
                key={step}
                scope="col"
                className="px-0.5 pt-2 pb-1 text-1 font-normal text-fg-muted"
              >
                {step}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SCALES.map(({ scale }) => (
            <tr key={scale}>
              <th scope="row" className="py-1 pr-2 align-top font-normal">
                <span className="flex flex-col">
                  <span className="text-2 text-fg">{label(scale)}</span>
                  <Code>{`--${scale}-*`}</Code>
                </span>
              </th>
              {STEPS.map((step) => {
                const token = `--${scale}-${step}`;
                return (
                  <td key={step} className="px-0.5 py-1 align-top">
                    <Swatch color={`var(${token})`} size="lg" />
                    <span className="mt-1 block truncate text-[10px] text-fg-muted">
                      <Value resolved={values.get(token)} />
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScaleDetail({ scale }: { scale: string }) {
  const [kind, setKind] = React.useState("solid");
  const values = useResolved(scaleTokens(scale), "color");
  return (
    <div className="flex flex-col gap-3 pt-4">
      <SegmentedControl
        aria-label="Steps"
        value={kind}
        onValueChange={setKind}
        size="sm"
        className="self-start"
      >
        <SegmentedControlItem value="solid">Solid</SegmentedControlItem>
        <SegmentedControlItem value="alpha">Alpha</SegmentedControlItem>
      </SegmentedControl>
      <Table
        caption={`${label(scale)} scale, ${kind} steps`}
        columns={[
          { label: "Step", className: "w-16" },
          { label: kind === "solid" ? "Solid" : "Alpha", className: "w-64" },
          { label: "Use" },
        ]}
      >
        {STEPS.map((step) => {
          const token =
            kind === "solid" ? `--${scale}-${step}` : `--${scale}-a${step}`;
          return (
            <Row key={step}>
              <Cell header>{kind === "solid" ? step : `a${step}`}</Cell>
              <Cell>
                <ColorValue token={token} resolved={values.get(token)} />
              </Cell>
              <Cell className="text-fg-muted">{STEP_USES[step]}</Cell>
            </Row>
          );
        })}
      </Table>
    </div>
  );
}

function ScaleTabs() {
  return (
    <Tabs defaultValue={SCALES[0]?.scale}>
      <TabsList aria-label="Scale">
        {SCALES.map(({ scale }) => (
          <TabsTab key={scale} value={scale}>
            {label(scale)}
          </TabsTab>
        ))}
      </TabsList>
      {SCALES.map(({ scale }) => (
        <TabsPanel key={scale} value={scale}>
          <ScaleDetail scale={scale} />
        </TabsPanel>
      ))}
    </Tabs>
  );
}

function rgbaOf(resolved: Resolved | undefined) {
  return resolved?.status === "color" ? resolved.rgba : null;
}

function matchingStep(
  values: ReadonlyMap<string, Resolved>,
  scale: string,
  token: string,
): number | null {
  const target = values.get(token);
  if (target?.status !== "color") return null;
  const step = STEPS.find((candidate) => {
    const value = values.get(`--${scale}-${candidate}`);
    return value?.status === "color" && value.value === target.value;
  });
  return step ?? null;
}

function Ratio({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-fg-danger">Unresolved</span>;
  const passes = ratio >= WCAG_AA_TEXT;
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums">{ratio.toFixed(2)}:1</span>
      <Badge color={passes ? "success" : "warning"}>
        {passes ? "AA" : "Under AA"}
      </Badge>
    </span>
  );
}

function ratioOf(
  values: ReadonlyMap<string, Resolved>,
  foreground: string,
  background: string,
): number | null {
  const fg = rgbaOf(values.get(foreground));
  const bg = rgbaOf(values.get(background));
  return fg === null || bg === null ? null : contrastRatio(fg, bg);
}

function StepName({ step }: { step: number | null }) {
  return step === null ? (
    <span className="text-fg-danger">Not a scale step</span>
  ) : (
    <span>Step {step}</span>
  );
}

function ReadableRow({ color, scale }: { color: Color; scale: string }) {
  const tokens = [
    ...STEPS.map((step) => `--${scale}-${step}`),
    `--${scale}-solid`,
    `--${scale}-solid-hover`,
    `--${scale}-text`,
    `--${scale}-contrast`,
  ];
  const values = useResolved(tokens, "color");
  const solid = `--${scale}-solid`;
  const text = `--${scale}-text`;
  const contrast = `--${scale}-contrast`;
  return (
    <>
      <Row>
        <Cell header>
          <ColorValue token={solid} resolved={values.get(solid)} />
        </Cell>
        <Cell>
          <StepName step={matchingStep(values, scale, solid)} />
        </Cell>
        <Cell>
          <Ratio ratio={ratioOf(values, contrast, solid)} />
        </Cell>
        <Cell>
          <Ratio ratio={ratioOf(values, contrast, `--${scale}-9`)} />
        </Cell>
        <Cell>
          <Button color={color} variant="solid" size="md">
            {label(scale)}
          </Button>
        </Cell>
      </Row>
      <Row>
        <Cell header>
          <ColorValue token={text} resolved={values.get(text)} />
        </Cell>
        <Cell>
          <StepName step={matchingStep(values, scale, text)} />
        </Cell>
        <Cell>
          <Ratio ratio={ratioOf(values, text, `--${scale}-3`)} />
        </Cell>
        <Cell>
          <Ratio ratio={ratioOf(values, `--${scale}-11`, `--${scale}-3`)} />
        </Cell>
        <Cell>
          <Button color={color} variant="soft" size="md">
            {label(scale)}
          </Button>
        </Cell>
      </Row>
      <Row>
        <Cell header>
          <ColorValue
            token={`--${scale}-solid-hover`}
            resolved={values.get(`--${scale}-solid-hover`)}
          />
        </Cell>
        <Cell className="text-fg-muted">Solid, mixed away from its label</Cell>
        <Cell>
          <Ratio ratio={ratioOf(values, contrast, `--${scale}-solid-hover`)} />
        </Cell>
        <Cell />
        <Cell />
      </Row>
    </>
  );
}

function ReadableSteps() {
  return (
    <Table
      caption="Readable steps per scale, with their contrast against Radix's own steps"
      columns={[
        { label: "Token" },
        { label: "Resolves to" },
        { label: "Contrast" },
        { label: "Radix's step" },
        { label: "Sample" },
      ]}
    >
      {SCALES.map(({ color, scale }) => (
        <ReadableRow key={scale} color={color} scale={scale} />
      ))}
    </Table>
  );
}

const ROLE_SECTIONS = (
  ["surface", "text", "line", "fill", "status", "gradient"] as const
).map((group) => ({ group, tokens: ROLE_GROUPS[group] }));

function sampleBackground(token: string): string {
  const on = /^--fg-on-(.+)$/.exec(token);
  if (on?.[1] !== undefined) return `var(--fill-${on[1]})`;
  if (token === "--fg-inverse") return "var(--surface-inverse)";
  return "var(--surface-canvas)";
}

function RoleSample({ group, token }: { group: string; token: string }) {
  if (group === "text") {
    return (
      <span
        aria-hidden="true"
        className="flex size-8 items-center justify-center rounded-control text-3 font-medium"
        style={{
          color: `var(${token})`,
          background: sampleBackground(token),
          boxShadow: "inset 0 0 0 1px var(--gray-a5)",
        }}
      >
        Aa
      </span>
    );
  }
  if (group === "line") {
    return (
      <span
        aria-hidden="true"
        className="block size-8 rounded-control"
        style={{ boxShadow: `inset 0 0 0 2px var(${token})` }}
      />
    );
  }
  return <Swatch color={`var(${token})`} />;
}

function RoleTable({
  group,
  tokens,
}: {
  group: string;
  tokens: readonly TokenName[];
}) {
  const stage = useStage();
  const values = useResolved(tokens, group === "gradient" ? "raw" : "color");
  const theme = stage === null ? undefined : getTheme(stage.theme);
  const mapping = (token: TokenName) =>
    theme === undefined || stage === null
      ? ""
      : (lookup(theme[stage.appearance], token) ??
        lookup(theme.base, token) ??
        "Not set");
  return (
    <Table
      caption={`${label(group)} roles`}
      columns={[
        { label: "Sample", hidden: true, className: "w-12" },
        { label: "Token" },
        { label: "Maps to in this theme" },
      ]}
    >
      {tokens.map((token) => (
        <Row key={token}>
          <Cell>
            <RoleSample group={group} token={token} />
          </Cell>
          <Cell header>
            <TokenValue token={token} resolved={values.get(token)} />
          </Cell>
          <Cell>
            <code
              className="text-1 break-all text-fg-muted"
              style={{ fontFamily: "var(--font-family-mono)" }}
            >
              {mapping(token)}
            </code>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function Roles() {
  return (
    <Tabs defaultValue={ROLE_SECTIONS[0]?.group}>
      <TabsList aria-label="Role group">
        {ROLE_SECTIONS.map(({ group }) => (
          <TabsTab key={group} value={group}>
            {label(group)}
          </TabsTab>
        ))}
      </TabsList>
      {ROLE_SECTIONS.map(({ group, tokens }) => (
        <TabsPanel key={group} value={group} className="pt-4">
          <RoleTable group={group} tokens={tokens} />
        </TabsPanel>
      ))}
    </Tabs>
  );
}

const ACCENT_STEPS = [3, 6, 9, 11] as const;

function ColorBinding() {
  const tokens = SCALES.flatMap(({ scale }) =>
    ACCENT_STEPS.map((step) => `--${scale}-${step}`),
  );
  const values = useResolved(tokens, "color");
  return (
    <Table
      caption="The color prop and the scale it binds"
      columns={[
        { label: "color" },
        { label: "Binds --accent-* to" },
        { label: "--accent-3, 6, 9, 11 inside" },
        { label: "Components" },
      ]}
    >
      {SCALES.map(({ color, scale }) => (
        <Row key={color}>
          <Cell header>
            <Code>{`color="${color}"`}</Code>
          </Cell>
          <Cell>
            <Code>{`--${scale}-*`}</Code>
          </Cell>
          <Cell>
            <span data-color={color} className="flex gap-2">
              {ACCENT_STEPS.map((step) => (
                <span key={step} className="flex flex-col items-start gap-1">
                  <Swatch color={`var(--accent-${step})`} size="sm" />
                  <Value resolved={values.get(`--${scale}-${step}`)} />
                </span>
              ))}
            </span>
          </Cell>
          <Cell>
            <span className="flex items-center gap-2">
              <Button color={color} size="sm">
                Save
              </Button>
              <Badge color={color}>{color}</Badge>
            </span>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

export function ColorPage() {
  return (
    <Page
      title="Color"
      intro="Every color comes from 12-step scales. Components read semantic roles and the accent binding, so swapping a theme restyles them with no code changes."
    >
      <Section title="Scales">
        <Prose>
          Each scale has 12 solid steps and 12 alpha steps that paint the same
          color over the page background. Steps 1 and 2 are backgrounds, 3 to 5
          interactive fills, 6 to 8 borders, 9 and 10 solid fills, and 11 and 12
          text.
        </Prose>
        <Overview />
        <ScaleTabs />
      </Section>
      <Section title="Readable steps">
        <Prose>
          At our 12px control text, Radix's step 9 under its label color and
          step 11 on step 3 fall under WCAG AA for some scales. The palette
          picks the nearest step that holds 4.5:1 and names it{" "}
          <Code>--*-solid</Code> and <Code>--*-text</Code>, keeping Radix's step
          wherever it passes. Solid buttons fill with <Code>--*-solid</Code>;
          soft ones write with <Code>--*-text</Code>.
        </Prose>
        <ReadableSteps />
      </Section>
      <Section title="Semantic roles">
        <Prose>
          Roles name what a color is for. Components and app chrome read roles;
          each theme maps them onto its own values.
        </Prose>
        <Roles />
      </Section>
      <Section title="The color prop">
        <Prose>
          A component's <Code>color</Code> prop writes <Code>data-color</Code>,
          which binds the <Code>--accent-*</Code> steps to one scale for that
          element and everything inside it. Unset, a component inherits the
          nearest binding, and the brand scale at the root.
        </Prose>
        <ColorBinding />
      </Section>
    </Page>
  );
}
