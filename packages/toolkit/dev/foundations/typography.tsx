import {
  FONT_FAMILIES,
  FONT_WEIGHTS,
  TYPE_RAMP,
} from "@agent-native/design-system";
import * as React from "react";

import { Link } from "../../src/ui/base-ui/link.js";
import { useResolved } from "./live.js";
import {
  Cell,
  Code,
  Page,
  Prose,
  Row,
  Section,
  Table,
  TokenValue,
  Value,
} from "./page.js";

const SAMPLE = "Ship the draft before the review";
const SHORT_SAMPLE = "Ship the draft";

function Families() {
  const tokens = Object.keys(FONT_FAMILIES).map(
    (name) => `--font-family-${name}`,
  );
  const values = useResolved(tokens, "raw");
  return (
    <Table
      caption="Font families"
      columns={[{ label: "Family" }, { label: "Token" }, { label: "Sample" }]}
    >
      {Object.keys(FONT_FAMILIES).map((name) => {
        const token = `--font-family-${name}`;
        return (
          <Row key={name}>
            <Cell header>{name}</Cell>
            <Cell>
              <TokenValue token={token} resolved={values.get(token)} />
            </Cell>
            <Cell>
              <span className="text-4" style={{ fontFamily: `var(${token})` }}>
                {SAMPLE}
              </span>
            </Cell>
          </Row>
        );
      })}
    </Table>
  );
}

function Scale() {
  const steps = TYPE_RAMP.map(({ step }) => step);
  const tokens = steps.flatMap((step) => [
    `--font-size-${step}`,
    `--line-height-${step}`,
    `--letter-spacing-${step}`,
  ]);
  const values = useResolved(tokens, "raw");
  return (
    <Table
      caption="Type scale"
      columns={[
        { label: "Step", className: "w-12" },
        { label: "Size" },
        { label: "Line height" },
        { label: "Letter spacing" },
        { label: "Sample" },
      ]}
    >
      {steps.map((step) => (
        <Row key={step}>
          <Cell header>{step}</Cell>
          {(["font-size", "line-height", "letter-spacing"] as const).map(
            (property) => {
              const token = `--${property}-${step}`;
              return (
                <Cell key={property}>
                  <TokenValue token={token} resolved={values.get(token)} />
                </Cell>
              );
            },
          )}
          <Cell>
            <span
              className="block max-w-[360px] truncate"
              style={{
                fontSize: `var(--font-size-${step})`,
                lineHeight: `var(--line-height-${step})`,
                letterSpacing: `var(--letter-spacing-${step})`,
              }}
            >
              {SHORT_SAMPLE}
            </span>
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function Weights() {
  const tokens = Object.keys(FONT_WEIGHTS).map(
    (name) => `--font-weight-${name}`,
  );
  const values = useResolved(tokens, "raw");
  return (
    <Table
      caption="Font weights"
      columns={[{ label: "Weight" }, { label: "Token" }, { label: "Sample" }]}
    >
      {Object.keys(FONT_WEIGHTS).map((name) => {
        const token = `--font-weight-${name}`;
        return (
          <Row key={name}>
            <Cell header>{name}</Cell>
            <Cell>
              <TokenValue token={token} resolved={values.get(token)} />
            </Cell>
            <Cell>
              <span className="text-4" style={{ fontWeight: `var(${token})` }}>
                {SAMPLE}
              </span>
            </Cell>
          </Row>
        );
      })}
    </Table>
  );
}

function ControlText() {
  const tokens = ["--control-font-size", "--control-line-height"];
  const values = useResolved(tokens, "raw");
  return (
    <Prose>
      Controls set their labels in <Code>--control-font-size</Code>{" "}
      <Value resolved={values.get("--control-font-size")} /> on{" "}
      <Code>--control-line-height</Code>{" "}
      <Value resolved={values.get("--control-line-height")} />, step 1 of the
      scale, at every control size.
    </Prose>
  );
}

const TEXT_COMPONENTS = [
  "Text",
  "Heading",
  "Link",
  "Code",
  "Blockquote",
  "Em",
  "Strong",
  "Quote",
] as const;

function TextComponents() {
  return (
    <Prose>
      The text components set text on this scale:{" "}
      {TEXT_COMPONENTS.map((name, index) => (
        <React.Fragment key={name}>
          {index === 0
            ? ""
            : index === TEXT_COMPONENTS.length - 1
              ? " and "
              : ", "}
          <Link
            href={`./?path=/docs/components-${name.toLowerCase()}--docs`}
            target="_top"
          >
            {name}
          </Link>
        </React.Fragment>
      ))}
      . Their <Code>size</Code> is a step, so size 3 sets step 3&apos;s size,
      line height and letter spacing together, and their <Code>weight</Code> is
      one of these weights.
    </Prose>
  );
}

export function TypographyPage() {
  return (
    <Page
      title="Typography"
      intro={`${Object.keys(FONT_FAMILIES).length} families, a ${TYPE_RAMP.length}-step type scale and ${Object.keys(FONT_WEIGHTS).length} weights. Each step pairs a size with its line height and letter spacing, so text set on a step needs no other value.`}
    >
      <Section title="Families">
        <Families />
      </Section>
      <Section title="Type scale">
        <ControlText />
        <Scale />
      </Section>
      <Section title="Weights">
        <Weights />
      </Section>
      <Section title="Text components">
        <TextComponents />
      </Section>
    </Page>
  );
}
