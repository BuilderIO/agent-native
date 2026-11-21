import {
  getTheme,
  RADIUS_PRESETS,
  RADIUS_STEPS,
  type RadiusPreset,
  radiusTokens,
  SHAPE_TOKEN_NAMES,
  STANDARD_SHAPE_TOKENS,
  type TokenMap,
} from "@agent-native/design-system";
import { IconInfoCircle } from "@tabler/icons-react";

import { Badge } from "../../src/ui/base-ui/badge.js";
import { Button } from "../../src/ui/base-ui/button.js";
import {
  Callout,
  CalloutIcon,
  CalloutText,
} from "../../src/ui/base-ui/callout.js";
import {
  lookup,
  resolvedText,
  useResolved,
  useStage,
  useTokenUsage,
} from "./live.js";
import {
  Cell,
  Code,
  Page,
  Prose,
  Row,
  Section,
  Table,
  TokenValue,
  UsageNote,
  UsedBy,
} from "./page.js";

function isPreset(value: string): value is RadiusPreset {
  return (RADIUS_PRESETS as readonly string[]).includes(value);
}

function Corner({ radius }: { radius: string }) {
  return (
    <span
      aria-hidden="true"
      className="block size-12 border border-line-strong bg-brand-a3"
      style={{ borderRadius: radius }}
    />
  );
}

function Steps() {
  const tokens = [
    "--radius-factor",
    ...RADIUS_STEPS.map((_, index) => `--radius-${index + 1}`),
    "--radius-full",
  ];
  const lengths = useResolved(tokens, "length");
  const raw = useResolved(["--radius-factor"], "raw");
  const usage = useTokenUsage();
  return (
    <>
      <Prose>
        Each step is its base value times <Code>--radius-factor</Code>, which is{" "}
        <Code>{resolvedText(raw.get("--radius-factor"))}</Code> here.
      </Prose>
      <Table
        caption="Radius steps"
        columns={[
          { label: "Token" },
          { label: "Base" },
          { label: "Used by" },
          { label: "Sample", hidden: true },
        ]}
      >
        {RADIUS_STEPS.map((base, index) => {
          const token = `--radius-${index + 1}`;
          return (
            <Row key={token}>
              <Cell header>
                <TokenValue token={token} resolved={lengths.get(token)} />
              </Cell>
              <Cell className="tabular-nums text-fg-muted">{base}px</Cell>
              <Cell>
                <UsedBy usage={usage} token={token} />
              </Cell>
              <Cell>
                <Corner radius={`var(${token})`} />
              </Cell>
            </Row>
          );
        })}
        <Row>
          <Cell header>
            <TokenValue
              token="--radius-full"
              resolved={lengths.get("--radius-full")}
            />
          </Cell>
          <Cell className="text-fg-muted">Pill</Cell>
          <Cell>
            <UsedBy usage={usage} token="--radius-full" />
          </Cell>
          <Cell>
            <Corner radius="var(--radius-full)" />
          </Cell>
        </Row>
      </Table>
    </>
  );
}

function useShapeMapping(): TokenMap {
  const stage = useStage();
  const theme = stage === null ? undefined : getTheme(stage.theme);
  if (stage === null || theme === undefined) return {};
  return stage.radius !== null && isPreset(stage.radius)
    ? { ...STANDARD_SHAPE_TOKENS, ...radiusTokens(stage.radius) }
    : theme.tokens;
}

function Shapes() {
  const values = useResolved(SHAPE_TOKEN_NAMES, "length");
  const usage = useTokenUsage();
  const mapping = useShapeMapping();
  return (
    <>
      <Table
        caption="Shape roles"
        columns={[
          { label: "Token" },
          { label: "Maps to" },
          { label: "Used by" },
          { label: "Sample", hidden: true },
        ]}
      >
        {SHAPE_TOKEN_NAMES.map((token) => (
          <Row key={token}>
            <Cell header>
              <TokenValue token={token} resolved={values.get(token)} />
            </Cell>
            <Cell>
              <code
                className="text-1 text-fg-muted"
                style={{ fontFamily: "var(--font-family-mono)" }}
              >
                {lookup(mapping, token) ?? "Not set"}
              </code>
            </Cell>
            <Cell>
              <UsedBy usage={usage} token={token} />
            </Cell>
            <Cell>
              <Corner radius={`var(${token})`} />
            </Cell>
          </Row>
        ))}
      </Table>
      <UsageNote usage={usage} />
    </>
  );
}

function ShapeSample() {
  return (
    <span className="flex flex-col gap-3">
      <span className="flex items-center gap-2">
        <Button size="sm">Save</Button>
        <Button size="sm" variant="outline">
          Cancel
        </Button>
        <Badge>Beta</Badge>
      </span>
      <Callout color="gray" variant="surface">
        <CalloutText>A callout rounds with --shape-panel.</CalloutText>
      </Callout>
    </span>
  );
}

function Presets() {
  const stage = useStage();
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {RADIUS_PRESETS.map((preset) => (
        <li
          key={preset}
          data-radius={preset}
          className="flex flex-col gap-3 rounded-card border border-line p-4"
        >
          <span className="flex items-center gap-2">
            <span className="text-2 text-fg">{preset}</span>
            <Code>{`factor ${radiusTokens(preset)["--radius-factor"] ?? ""}`}</Code>
            {stage?.radius === preset ? (
              <Badge variant="soft">Current</Badge>
            ) : null}
          </span>
          <ShapeSample />
        </li>
      ))}
    </ul>
  );
}

const SQUIRCLE_SUPPORT = "superellipse(2)";

function Corners() {
  const supported = CSS.supports("corner-shape", SQUIRCLE_SUPPORT);
  const values = useResolved(["--corner-shape", "--corner-scale"], "raw");
  return (
    <>
      {supported ? null : (
        <Callout color="warning">
          <CalloutIcon>
            <IconInfoCircle />
          </CalloutIcon>
          <CalloutText>
            This browser has no <Code>corner-shape</Code>, so squircle corners
            render round here.
          </CalloutText>
        </Callout>
      )}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(["round", "squircle"] as const).map((corners) => (
          <li
            key={corners}
            data-corners={corners}
            data-radius="large"
            className="flex flex-col gap-3 rounded-card border border-line p-4"
          >
            <span className="text-2 text-fg">{corners}</span>
            <ShapeSample />
          </li>
        ))}
      </ul>
      <p className="text-1 text-fg-muted">
        On the stage, <Code>--corner-shape</Code> is{" "}
        <Code>{resolvedText(values.get("--corner-shape"))}</Code> and{" "}
        <Code>--corner-scale</Code> is{" "}
        <Code>{resolvedText(values.get("--corner-scale"))}</Code>.
      </p>
    </>
  );
}

export function RadiusPage() {
  return (
    <Page
      title="Radius and shape"
      intro="Parts round their corners through shape roles. A theme maps each role onto its radius, a preset rescales every step at once, and corners pick the curve."
    >
      <Section title="Radius steps">
        <Steps />
      </Section>
      <Section title="Shape roles">
        <Prose>
          Parts round with the role for what they are: a control, a popup, a
          card, a panel, a dialog or a pill. A theme can then reshape every part
          of one kind at once.
        </Prose>
        <Shapes />
      </Section>
      <Section title="Presets">
        <Prose>
          <Code>data-radius</Code> sets the factor for a subtree, and the{" "}
          <Code>radius</Code> prop sets it for one component. Full also turns
          controls into pills.
        </Prose>
        <Presets />
      </Section>
      <Section title="Corners">
        <Prose>
          <Code>data-corners="squircle"</Code> draws a superellipse, scaled up a
          quarter so it reads the same size as the round corner. Both samples
          use the large preset to make the curve visible.
        </Prose>
        <Corners />
      </Section>
    </Page>
  );
}
