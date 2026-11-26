import {
  CONTROL_HEIGHT_STEPS,
  CONTROL_SIZES,
  DENSITIES,
  type Density,
  densityTokens,
  type TokenName,
} from "@agent-native/design-system";

import { Badge } from "../../src/ui/base-ui/badge.js";
import { Button } from "../../src/ui/base-ui/button.js";
import { useResolved, useStage } from "./live.js";
import {
  Cell,
  Code,
  Page,
  Prose,
  Row,
  Section,
  Table,
  TokenValue,
} from "./page.js";

const byDensity = Object.fromEntries(
  DENSITIES.map((density) => [density, densityTokens(density)]),
) as Record<Density, Record<TokenName, string>>;

const DEFAULT_TOKENS = densityTokens("default");

const SPACE_TOKENS = Object.keys(DEFAULT_TOKENS).filter((token) =>
  token.startsWith("--space-"),
) as TokenName[];

function DensityHeader({ density }: { density: string }) {
  const stage = useStage();
  return (
    <span className="flex items-center gap-1">
      {density}
      {stage?.density === density ? (
        <Badge variant="soft">Current</Badge>
      ) : null}
    </span>
  );
}

const densityColumns = () =>
  DENSITIES.map((density) => ({
    label: density,
    content: <DensityHeader density={density} />,
    className: "w-28",
  }));

function SpaceScale() {
  const values = useResolved(SPACE_TOKENS, "length");
  return (
    <Table
      caption="Space scale at each density"
      columns={[{ label: "Token" }, { label: "Live" }, ...densityColumns()]}
    >
      {SPACE_TOKENS.map((token) => (
        <Row key={token}>
          <Cell header>
            <TokenValue token={token} resolved={values.get(token)} />
          </Cell>
          <Cell className="w-[45%]">
            <span
              aria-hidden="true"
              className="block h-3 rounded-control bg-brand-9"
              style={{ width: `var(${token})` }}
            />
          </Cell>
          {DENSITIES.map((density) => (
            <Cell key={density} className="tabular-nums text-fg-muted">
              {byDensity[density][token]}
            </Cell>
          ))}
        </Row>
      ))}
    </Table>
  );
}

const CONTROL_TOKENS = [
  ...CONTROL_HEIGHT_STEPS.flatMap((step) => [
    `--control-height-${step}`,
    `--control-padding-x-${step}`,
  ]),
  "--control-gap",
] as TokenName[];

function ControlScale() {
  const values = useResolved(CONTROL_TOKENS, "length");
  return (
    <Table
      caption="Control tokens at each density"
      columns={[
        { label: "Token" },
        { label: "Changes with density" },
        ...densityColumns(),
      ]}
    >
      {CONTROL_TOKENS.map((token) => {
        const varies = new Set(
          DENSITIES.map((density) => byDensity[density][token]),
        );
        return (
          <Row key={token}>
            <Cell header>
              <TokenValue token={token} resolved={values.get(token)} />
            </Cell>
            <Cell className="text-fg-muted">
              {varies.size > 1 ? "Yes" : "No"}
            </Cell>
            {DENSITIES.map((density) => (
              <Cell key={density} className="tabular-nums text-fg-muted">
                {byDensity[density][token]}
              </Cell>
            ))}
          </Row>
        );
      })}
    </Table>
  );
}

function Comparison() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {DENSITIES.map((density) => (
        <li
          key={density}
          data-density={density}
          className="flex flex-col gap-3 rounded-card border border-line p-4"
        >
          <span className="text-2 text-fg">{density}</span>
          <span className="flex flex-wrap items-center gap-(--space-2)">
            {CONTROL_SIZES.map((size) => (
              <Button key={size} size={size} variant="soft">
                {size}
              </Button>
            ))}
          </span>
          <span className="flex flex-col gap-(--space-2)">
            {[1, 2, 3].map((line) => (
              <span
                key={line}
                aria-hidden="true"
                className="block h-2 rounded-control bg-gray-a4"
              />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SpacePage() {
  return (
    <Page
      title="Space and density"
      intro={`A ${SPACE_TOKENS.length}-step space scale on a 4px grid. Density swaps the scale, control padding and the gap inside a control. Control heights never change with density.`}
    >
      <Section title="Space scale">
        <Prose>
          Lay out gaps and padding with <Code>--space-1</Code> to{" "}
          <Code>{SPACE_TOKENS.at(-1)}</Code>. Each density keeps every step
          distinct, so a layout keeps its rhythm when density changes.
        </Prose>
        <SpaceScale />
      </Section>
      <Section title="Controls">
        <Prose>
          Compact trims control padding and comfortable adds to it. With a 16px
          floor there is no smaller height to step down to, so heights stay
          fixed and two sizes never collapse into one.
        </Prose>
        <ControlScale />
      </Section>
      <Section title="Side by side">
        <Comparison />
      </Section>
    </Page>
  );
}
