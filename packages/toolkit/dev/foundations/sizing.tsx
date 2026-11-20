import {
  CONTROL_SIZES,
  type EnumPropDef,
  PARTS,
  type PropDefs,
  SIZE_RAMP,
} from "@agent-native/design-system";
import { IconPlus } from "@tabler/icons-react";

import { Badge } from "../../src/ui/base-ui/badge.js";
import { Button, IconButton } from "../../src/ui/base-ui/button.js";
import { type Resolved, useResolved } from "./live.js";
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

const px = (resolved: Resolved | undefined) =>
  resolved?.status === "ok" ? Number.parseFloat(resolved.value) : null;

function ControlSizes() {
  const tokens = CONTROL_SIZES.flatMap((size) => [
    `--control-height-${size}`,
    `--control-icon-size-${size}`,
    `--control-padding-x-${size}`,
  ]);
  const values = useResolved(tokens, "length");
  return (
    <Table
      caption="Control sizes"
      columns={[
        { label: "size", className: "w-12" },
        { label: "Height" },
        { label: "Icon" },
        { label: "Icon inset" },
        { label: "Padding" },
        { label: "Sample" },
      ]}
    >
      {CONTROL_SIZES.map((size) => {
        const height = `--control-height-${size}`;
        const icon = `--control-icon-size-${size}`;
        const padding = `--control-padding-x-${size}`;
        const h = px(values.get(height));
        const i = px(values.get(icon));
        return (
          <Row key={size}>
            <Cell header>
              <Code>{`"${size}"`}</Code>
            </Cell>
            <Cell>
              <TokenValue token={height} resolved={values.get(height)} />
            </Cell>
            <Cell>
              <TokenValue token={icon} resolved={values.get(icon)} />
            </Cell>
            <Cell className="tabular-nums text-fg-muted">
              {h === null || i === null ? "" : `${(h - i) / 2}px`}
            </Cell>
            <Cell>
              <TokenValue token={padding} resolved={values.get(padding)} />
            </Cell>
            <Cell>
              <span className="flex items-center gap-2">
                <Button size={size} variant="soft">
                  Button
                </Button>
                <IconButton size={size} variant="soft" aria-label="Add">
                  <IconPlus />
                </IconButton>
              </span>
            </Cell>
          </Row>
        );
      })}
    </Table>
  );
}

function BoxSizes() {
  const tokens = SIZE_RAMP.map((_, index) => `--size-${index + 1}`);
  const values = useResolved(tokens, "length");
  return (
    <ul aria-label="Box sizes" className="flex flex-wrap items-end gap-6">
      {tokens.map((token) => (
        <li key={token} className="flex flex-col gap-2">
          <span
            aria-hidden="true"
            className="block rounded-control bg-brand-a4"
            style={{ width: `var(${token})`, height: `var(${token})` }}
          />
          <TokenValue token={token} resolved={values.get(token)} />
        </li>
      ))}
    </ul>
  );
}

interface SizeUse {
  component: string;
  def: EnumPropDef;
}

function sizeDef(props: PropDefs | undefined): EnumPropDef | null {
  const def = props?.size;
  return def?.type === "enum" ? def : null;
}

const SIZE_USES: readonly SizeUse[] = [...PARTS]
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((part) => {
    const own = sizeDef(part.props);
    const subParts = Object.entries(part.subPartProps ?? {}).flatMap(
      ([subPart, props]) => {
        const def = sizeDef(props);
        return def === null
          ? []
          : [{ component: `${part.name}-${subPart}`, def }];
      },
    );
    return [
      ...(own === null ? [] : [{ component: part.name, def: own }]),
      ...subParts,
    ];
  });

function SizeVocabulary() {
  return (
    <Table
      caption="The size prop across components"
      columns={[
        { label: "Component" },
        { label: "Values" },
        { label: "Default" },
        { label: "Means" },
      ]}
    >
      {SIZE_USES.map(({ component, def }) => (
        <Row key={component}>
          <Cell header>
            <Code>{component}</Code>
          </Cell>
          <Cell>
            <span className="flex flex-wrap gap-1">
              {def.values.map((value) => (
                <Badge
                  key={value}
                  size="1"
                  color={value === def.default ? "accent" : "gray"}
                  variant="soft"
                >
                  {value}
                </Badge>
              ))}
            </span>
          </Cell>
          <Cell className="tabular-nums">{def.default ?? "None"}</Cell>
          <Cell className="text-fg-muted">{def.description}</Cell>
        </Row>
      ))}
    </Table>
  );
}

export function SizingPage() {
  return (
    <Page
      title="Sizing"
      intro={`Controls come in ${CONTROL_SIZES.length} heights, numbered as Radix numbers them. Each height has its own icon size and padding, and the icon sits centered with an inset of half the difference.`}
    >
      <Section title="Control sizes">
        <ControlSizes />
      </Section>
      <Section title="Box sizes">
        <Prose>
          Boxes that are not controls, such as avatars, thumbnails and rows,
          size on <Code>--size-1</Code> to{" "}
          <Code>{`--size-${SIZE_RAMP.length}`}</Code>.
        </Prose>
        <BoxSizes />
      </Section>
      <Section title="The size prop">
        <Prose>
          Every component spells size the same way: a string step, where a
          control's step is its height. Components that are not controls use the
          same steps for their own scale.
        </Prose>
        <SizeVocabulary />
      </Section>
    </Page>
  );
}
