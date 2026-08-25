import { IconBolt } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "../components/website-redesign/ds/button";
import { Category } from "../components/website-redesign/ds/category";
import { Checkbox } from "../components/website-redesign/ds/checkbox";
import { CodeBlock } from "../components/website-redesign/ds/code-block";
import { CodeTag } from "../components/website-redesign/ds/code-tag";
import { ColumnDivider } from "../components/website-redesign/ds/column-divider";
import { Cursor } from "../components/website-redesign/ds/cursor";
import { Eyebrow } from "../components/website-redesign/ds/eyebrow";
import { FeatureCard } from "../components/website-redesign/ds/feature-card";
import { FormSelect } from "../components/website-redesign/ds/form-select";
import { IconBox } from "../components/website-redesign/ds/icon-box";
import { ImgPlaceholder } from "../components/website-redesign/ds/img-placeholder";
import { Input } from "../components/website-redesign/ds/input";
import { Kbd } from "../components/website-redesign/ds/kbd";
import { Radio } from "../components/website-redesign/ds/radio";
import { SectionHeader } from "../components/website-redesign/ds/section-header";
import { Select } from "../components/website-redesign/ds/select";
import { TabItem } from "../components/website-redesign/ds/tab-item";
import { Toggle } from "../components/website-redesign/ds/toggle";
import { Tooltip } from "../components/website-redesign/ds/tooltip";
import {
  GridCols,
  GridInner,
  PageSection,
} from "../components/website-redesign/page-grid";

import tokensCss from "../components/website-redesign/tokens.css?url";

export const links = () => [{ rel: "stylesheet", href: tokensCss }];

export const meta = () => [
  { title: "Website Redesign — Internal Preview" },
  { name: "robots", content: "noindex,nofollow" },
];

const RAW_COLORS = [
  ["--c-violet-400", "#A8C1FF"],
  ["--c-blue-100", "#BEF0F5"],
  ["--c-blue-200", "#7BE8F5"],
  ["--c-blue-300", "#00DFF6"],
  ["--c-blue-400", "#00D6F6"],
  ["--c-blue-500", "#01C8F1"],
  ["--c-blue-600", "#009CCC"],
  ["--c-blue-900", "#00161B"],
  ["--c-green-400", "#0FDFBA"],
  ["--c-yellow-400", "#DEC75F"],
  ["--c-red-400", "#FFA27D"],
  ["--c-pink-400", "#FA9BF2"],
  ["--c-neutral-50", "#FAF9F5"],
  ["--c-neutral-100", "#E0E0D7"],
  ["--c-neutral-200", "#CAC9C6"],
  ["--c-neutral-400", "#ABABAB"],
  ["--c-neutral-500", "#9A9997"],
  ["--c-neutral-600", "#5E5E5E"],
  ["--c-neutral-700", "#3D3D3D"],
  ["--c-neutral-800", "#2E2E2E"],
  ["--c-neutral-900", "#1A1A1A"],
  ["--c-neutral-925", "#0F0F0F"],
  ["--c-neutral-950", "#0A0A0A"],
] as const;

const SEMANTIC_COLORS = [
  ["--b-bg-page", "bg"],
  ["--b-bg-raised", "bg"],
  ["--b-bg-prominent", "bg"],
  ["--b-bg-alternative", "bg"],
  ["--b-text-primary", "text"],
  ["--b-text-secondary", "text"],
  ["--b-text-muted", "text"],
  ["--b-text-eyebrow", "text"],
  ["--b-action-primary-bg", "action"],
  ["--b-action-secondary-border", "action"],
] as const;

const TYPE_SCALE = [
  ["--b-t-heading-1", "Heading 1"],
  ["--b-t-heading-2", "Heading 2"],
  ["--b-t-heading-3", "Heading 3"],
  ["--b-t-heading-4", "Heading 4"],
  ["--b-t-heading-5", "Heading 5"],
  ["--b-t-heading-6", "Heading 6"],
  ["--b-t-paragraph-1", "Paragraph 1"],
  ["--b-t-paragraph-2", "Paragraph 2"],
  ["--b-t-paragraph-3", "Paragraph 3"],
  ["--b-t-label-1", "Label 1"],
  ["--b-t-label-2", "Label 2"],
] as const;

const SPACING_SCALE = [
  "--spacing-1",
  "--spacing-2",
  "--spacing-3",
  "--spacing-4",
  "--spacing-5",
  "--spacing-6",
  "--spacing-8",
  "--spacing-10",
  "--spacing-12",
  "--spacing-16",
  "--spacing-20",
  "--spacing-24",
] as const;

const SNIPPET_TABS = [
  {
    label: "button.tsx",
    language: "tsx",
    code: `<Button variant="primary">Get started</Button>`,
  },
  {
    label: "tokens.css",
    language: "css",
    code: `.builder-brand-tokens {\n  --b-text-eyebrow: #01C8F1;\n}`,
  },
];

function borderTopStyle() {
  return { borderTop: "1px solid var(--b-border-subtle)" };
}

export default function WebsiteRedesignHomepage() {
  const [activeTab, setActiveTab] = useState(0);
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(true);
  const [radioValue, setRadioValue] = useState("a");
  const [selectValue, setSelectValue] = useState("first");

  return (
    <div className="builder-brand-tokens" style={{ minHeight: "100vh" }}>
      <PageSection>
        <GridInner
          style={{
            padding: "var(--spacing-30) var(--spacing-10) var(--spacing-20)",
          }}
        >
          <Eyebrow>Internal Preview</Eyebrow>
          <h1
            style={{
              margin: "var(--spacing-3) 0 0",
              fontFamily: "var(--b-font-sans)",
              fontSize: "var(--b-t-heading-1)",
              fontWeight: 500,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: "var(--b-text-primary)",
            }}
          >
            This is the redesign route
          </h1>
          <p
            style={{
              marginTop: "var(--spacing-4)",
              maxWidth: 640,
              fontFamily: "var(--b-font-sans)",
              fontSize: "var(--b-t-paragraph-1)",
              color: "var(--b-text-secondary)",
              lineHeight: 1.4,
            }}
          >
            A hidden, SEO-excluded route for building new marketing pages
            against the Builder design system, scoped to this page tree only.
          </p>
        </GridInner>
      </PageSection>

      {/* Color tokens */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10)",
          }}
        >
          <SectionHeader eyebrow="Tokens" heading="Color primitives" />
          <div
            style={{
              marginTop: "var(--spacing-8)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "var(--spacing-4)",
            }}
          >
            {RAW_COLORS.map(([name, hex]) => (
              <div key={name}>
                <div
                  title={hex}
                  style={{
                    height: 64,
                    borderRadius: "var(--b-radius)",
                    border: "1px solid var(--b-border-default)",
                    background: `var(${name})`,
                  }}
                />
                <p
                  style={{
                    margin: "var(--spacing-1) 0 0",
                    fontFamily: "var(--b-font-mono)",
                    fontSize: "var(--b-t-label-2)",
                    color: "var(--b-text-secondary)",
                  }}
                >
                  {name}
                </p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "var(--spacing-10)" }}>
            <SectionHeader eyebrow="Tokens" heading="Semantic tokens" />
            <div
              style={{
                marginTop: "var(--spacing-6)",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: "var(--spacing-4)",
              }}
            >
              {SEMANTIC_COLORS.map(([name, kind]) => (
                <div key={name}>
                  <div
                    style={{
                      height: 48,
                      borderRadius: "var(--b-radius)",
                      border: "1px solid var(--b-border-default)",
                      background:
                        kind === "text" ? "var(--b-bg-raised)" : `var(${name})`,
                      color: kind === "text" ? `var(${name})` : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--b-font-sans)",
                      fontSize: "var(--b-t-label-1)",
                    }}
                  >
                    {kind === "text" ? "Aa" : ""}
                  </div>
                  <p
                    style={{
                      margin: "var(--spacing-1) 0 0",
                      fontFamily: "var(--b-font-mono)",
                      fontSize: "var(--b-t-label-2)",
                      color: "var(--b-text-secondary)",
                    }}
                  >
                    {name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </GridInner>
      </PageSection>

      {/* Typography */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10)",
          }}
        >
          <SectionHeader eyebrow="Tokens" heading="Typography scale" />
          <div
            style={{
              marginTop: "var(--spacing-8)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-4)",
            }}
          >
            {TYPE_SCALE.map(([name, label]) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--spacing-4)",
                  borderBottom: "1px solid var(--b-border-subtle)",
                  paddingBottom: "var(--spacing-3)",
                }}
              >
                <span
                  style={{
                    width: 220,
                    flexShrink: 0,
                    fontFamily: "var(--b-font-mono)",
                    fontSize: "var(--b-t-label-2)",
                    color: "var(--b-text-secondary)",
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    fontFamily: "var(--b-font-sans)",
                    fontSize: `var(${name})`,
                    color: "var(--b-text-primary)",
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* Spacing */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10)",
          }}
        >
          <SectionHeader eyebrow="Tokens" heading="Spacing scale" />
          <div
            style={{
              marginTop: "var(--spacing-8)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-2)",
            }}
          >
            {SPACING_SCALE.map((name) => (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--spacing-4)",
                }}
              >
                <span
                  style={{
                    width: 120,
                    flexShrink: 0,
                    fontFamily: "var(--b-font-mono)",
                    fontSize: "var(--b-t-label-2)",
                    color: "var(--b-text-secondary)",
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    height: 12,
                    width: `var(${name})`,
                    background: "var(--b-action-primary-bg)",
                    borderRadius: "var(--b-radius-sm)",
                  }}
                />
              </div>
            ))}
          </div>
        </GridInner>
      </PageSection>

      {/* Gradient */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10)",
          }}
        >
          <SectionHeader eyebrow="Tokens" heading="Gradient" />
          <div
            style={{
              marginTop: "var(--spacing-6)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-4)",
            }}
          >
            <div
              className="blue-gradient"
              style={{ height: 64, borderRadius: "var(--b-radius)" }}
            />
            <p
              className="blue-gradient-text"
              style={{
                margin: 0,
                fontFamily: "var(--b-font-sans)",
                fontSize: "var(--b-t-heading-3)",
                fontWeight: 500,
              }}
            >
              Gradient text example
            </p>
          </div>
        </GridInner>
      </PageSection>

      {/* Buttons */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10)",
          }}
        >
          <SectionHeader eyebrow="Components" heading="Buttons" />
          <div
            style={{
              marginTop: "var(--spacing-6)",
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--spacing-4)",
            }}
          >
            <Button variant="cta">Get started</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="primary-alt">Primary alt</Button>
            <Button variant="primary-icon">Primary icon</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="secondary-icon">Secondary icon</Button>
          </div>
        </GridInner>
      </PageSection>

      {/* Form atoms */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10)",
          }}
        >
          <SectionHeader eyebrow="Components" heading="Form atoms" />
          <GridCols
            style={{ marginTop: "var(--spacing-6)", gap: "var(--spacing-6)" }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--spacing-4)",
              }}
            >
              <Input placeholder="Type here..." />
              <FormSelect
                label="Plan"
                value={selectValue}
                onChange={setSelectValue}
                options={[
                  { label: "First option", value: "first" },
                  { label: "Second option", value: "second" },
                  { label: "Third option", value: "third" },
                ]}
              />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--spacing-3)",
              }}
            >
              <Checkbox
                label="Enable feature"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <Radio
                label="Option A"
                name="radio-demo"
                checked={radioValue === "a"}
                onChange={() => setRadioValue("a")}
              />
              <Radio
                label="Option B"
                name="radio-demo"
                checked={radioValue === "b"}
                onChange={() => setRadioValue("b")}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--spacing-2)",
                }}
              >
                <Toggle
                  checked={toggled}
                  onChange={setToggled}
                  label="Toggle example"
                />
                <span
                  style={{
                    fontFamily: "var(--b-font-sans)",
                    fontSize: "var(--b-t-paragraph-2)",
                    color: "var(--b-text-secondary)",
                  }}
                >
                  Toggle
                </span>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--spacing-3)",
              }}
            >
              <Select
                value={selectValue}
                onChange={setSelectValue}
                options={[
                  { label: "First option", value: "first" },
                  { label: "Second option", value: "second" },
                  { label: "Third option", value: "third" },
                ]}
              />
            </div>
          </GridCols>
        </GridInner>
      </PageSection>

      {/* Tabs + CodeBlock */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10)",
          }}
        >
          <SectionHeader eyebrow="Components" heading="Tabs + code block" />
          <div
            style={{
              marginTop: "var(--spacing-6)",
              display: "flex",
              gap: "var(--spacing-2)",
            }}
          >
            {SNIPPET_TABS.map((tab, i) => (
              <TabItem
                key={tab.label}
                active={i === activeTab}
                onClick={() => setActiveTab(i)}
              >
                {tab.label}
              </TabItem>
            ))}
          </div>
          <div style={{ marginTop: "var(--spacing-4)" }}>
            <CodeBlock
              tabs={SNIPPET_TABS}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </div>
        </GridInner>
      </PageSection>

      {/* Misc atoms */}
      <PageSection>
        <GridInner
          style={{
            ...borderTopStyle(),
            padding: "var(--spacing-16) var(--spacing-10) var(--spacing-30)",
          }}
        >
          <SectionHeader eyebrow="Components" heading="Misc atoms" />
          <div
            style={{
              marginTop: "var(--spacing-6)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "var(--spacing-6)",
            }}
          >
            <Tooltip content="Helpful hint">
              <Button variant="secondary">Hover me</Button>
            </Tooltip>
            <Kbd>⌘K</Kbd>
            <Category>New</Category>
            <IconBox>
              <IconBolt size={20} />
            </IconBox>
            <CodeTag>getBuilderImageUrl()</CodeTag>
            <Cursor label="Guest" />
            <ColumnDivider />
          </div>
          <div
            style={{
              marginTop: "var(--spacing-8)",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: "var(--spacing-4)",
            }}
          >
            <FeatureCard
              icon={
                <IconBox>
                  <IconBolt size={20} />
                </IconBox>
              }
              title="Feature card"
              description="A short description of the feature living in this card."
            />
            <ImgPlaceholder label="Image placeholder" />
          </div>
        </GridInner>
      </PageSection>
    </div>
  );
}
