import { getTheme, ROLE_GROUPS } from "@agent-native/design-system";

import { lookup, useResolved, useStage, useTokenUsage } from "./live.js";
import {
  Cell,
  Page,
  Prose,
  Row,
  Section,
  Table,
  UsageNote,
  UsedBy,
  Value,
} from "./page.js";

const SHADOWS = ROLE_GROUPS.elevation;

function Levels() {
  return (
    <ul className="grid grid-cols-2 gap-6 rounded-panel bg-surface-sunken p-6 sm:grid-cols-3">
      {SHADOWS.map((token, index) => (
        <li
          key={token}
          className="flex h-24 flex-col justify-end rounded-card bg-surface-raised p-3"
          style={{ boxShadow: `var(${token})` }}
        >
          <span className="text-2 text-fg">Level {index + 1}</span>
          <code
            className="text-1 text-fg-muted"
            style={{ fontFamily: "var(--font-family-mono)" }}
          >
            {token}
          </code>
        </li>
      ))}
    </ul>
  );
}

function ShadowTable() {
  const stage = useStage();
  const values = useResolved(SHADOWS, "raw");
  const usage = useTokenUsage();
  const theme = stage === null ? undefined : getTheme(stage.theme);
  return (
    <>
      <Table
        caption="Shadows"
        columns={[
          { label: "Token", className: "w-28" },
          { label: "Used by", className: "w-56" },
          { label: "Value in this theme" },
        ]}
      >
        {SHADOWS.map((token) => (
          <Row key={token}>
            <Cell header>
              <code style={{ fontFamily: "var(--font-family-mono)" }}>
                {token}
              </code>
            </Cell>
            <Cell>
              <UsedBy usage={usage} token={token} />
            </Cell>
            <Cell>
              <span className="flex flex-col gap-1">
                {theme === undefined || stage === null ? null : (
                  <code
                    className="text-1 break-all text-fg"
                    style={{ fontFamily: "var(--font-family-mono)" }}
                  >
                    {lookup(theme[stage.appearance], token) ??
                      lookup(theme.base, token) ??
                      "Not set"}
                  </code>
                )}
                <Value resolved={values.get(token)} />
              </span>
            </Cell>
          </Row>
        ))}
      </Table>
      <UsageNote usage={usage} />
    </>
  );
}

export function ElevationPage() {
  return (
    <Page
      title="Elevation"
      intro={`${SHADOWS.length} shadow levels lift a surface off the page. The higher the level, the further the surface floats and the more it covers.`}
    >
      <Section title="Levels">
        <Levels />
      </Section>
      <Section title="Shadows">
        <Prose>
          Each level is a role, so a theme can redraw it. The baseline theme
          draws a hairline ring under a shadow that deepens in dark; the
          Agent-Native and app themes use Tailwind's shadows. The second line is
          the value as the browser resolved it.
        </Prose>
        <ShadowTable />
      </Section>
    </Page>
  );
}
