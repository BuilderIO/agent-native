import {
  IconArrowUpRight,
  IconPalette,
  IconPresentation,
  IconScissors,
  type IconProps,
} from "@tabler/icons-react";
import { useState, type ComponentType } from "react";
import { Link } from "react-router";

import { TabItem } from "./ds/tab-item";
import { GridInner, PageSection } from "./page-grid";

type TablerIcon = ComponentType<IconProps>;

interface ShowcaseTab {
  id: string;
  label: string;
  icon: TablerIcon;
  title: string;
  body: string;
  image: string;
  href: string;
}

const TABS: ShowcaseTab[] = [
  {
    id: "clips",
    label: "Clips",
    icon: IconScissors,
    title: "Familiar clip editor",
    body: "Give users a familiar clip editor, and let the agent transcribe, trim, and caption footage automatically.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fab7beeb1f62548fab6e2a710d880a20c?format=webp&width=800",
    href: "/apps/clips",
  },
  {
    id: "slides",
    label: "Slides",
    icon: IconPresentation,
    title: "Decks, drafted together",
    body: "Build decks together — the agent drafts slides, tightens copy, and keeps every version in sync.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4b196d8d24c44914a021d1577f10879b",
    href: "/apps/slides",
  },
  {
    id: "design",
    label: "Design",
    icon: IconPalette,
    title: "Shared creative canvas",
    body: "Sketch flows and mini apps on a shared canvas the agent can generate, edit, and ship alongside you.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F75026532fe204acbab72d41dbeb34305?format=webp&width=800&height=1200",
    href: "/apps/design",
  },
];

export function TemplateShowcase() {
  const [activeId, setActiveId] = useState(TABS[0].id);
  const activeIndex = TABS.findIndex((tab) => tab.id === activeId);

  return (
    <PageSection>
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-6)",
          padding: "var(--spacing-40) var(--spacing-8) var(--spacing-20)",
          borderTop: "1px solid var(--b-border-default)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-heading-2)",
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "var(--b-text-primary)",
          }}
        >
          What can you build with Agent-Native?
        </h2>
        <p
          style={{
            margin: 0,
            maxWidth: 633,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-paragraph-2)",
            lineHeight: 1.4,
            color: "var(--b-text-secondary)",
          }}
        >
          Start with chat, a focused internal tool, or a complete
          customer-facing product. Every app gives users a UI and agents the
          tools to do the same work.
        </p>
      </GridInner>

      <GridInner>
        <div
          style={{
            border: "1px solid var(--b-border-default)",
            borderTop: "none",
          }}
        >
          <div
            role="tablist"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              borderBottom: "1px solid var(--b-border-default)",
            }}
          >
            {TABS.map((tab, index) => {
              const Icon = tab.icon;
              return (
                <div
                  key={tab.id}
                  style={{
                    display: "grid",
                    borderTop: "1px solid var(--b-border-subtle)",
                    borderRight:
                      index < TABS.length - 1
                        ? "1px solid var(--b-border-subtle)"
                        : "none",
                  }}
                >
                  <TabItem
                    active={tab.id === activeId}
                    onClick={() => setActiveId(tab.id)}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        textTransform: "uppercase",
                      }}
                    >
                      <Icon size={16} stroke={1.75} />
                      {tab.label}
                    </span>
                  </TabItem>
                </div>
              );
            })}
          </div>

          <div style={{ display: "grid", overflow: "hidden" }}>
            {TABS.map((tab, index) => {
              const isActive = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  aria-hidden={!isActive}
                  inert={!isActive || undefined}
                  className="template-showcase-panel"
                  style={{
                    gridArea: "1 / 1",
                    transform: `translateX(${(index - activeIndex) * 100}%)`,
                    transition:
                      "transform 0.35s cubic-bezier(0.37, 0.01, 0, 0.98)",
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                >
                  <Link
                    to={tab.href}
                    className="template-showcase-cell"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      justifyContent: "center",
                      textAlign: "left",
                      gap: "var(--spacing-4)",
                      padding: "var(--spacing-8)",
                      borderRight: "1px solid var(--b-border-subtle)",
                      textDecoration: "none",
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontFamily: "var(--b-font-sans)",
                        fontSize: "var(--b-t-heading-6)",
                        fontWeight: 500,
                        lineHeight: 1.15,
                        letterSpacing: "-0.02em",
                        color: "var(--b-text-primary)",
                      }}
                    >
                      {tab.title}
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        fontFamily: "var(--b-font-sans)",
                        fontSize: "var(--b-t-paragraph-2)",
                        lineHeight: 1.4,
                        color: "var(--b-text-secondary)",
                      }}
                    >
                      {tab.body}
                    </p>
                    <span
                      aria-hidden="true"
                      className="template-showcase-arrow"
                      style={{
                        alignSelf: "flex-start",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        border: "1px solid var(--b-action-secondary-border)",
                        borderRadius: "var(--b-radius)",
                        color: "var(--b-text-primary)",
                        transition:
                          "background 0.15s, border-color 0.15s, color 0.15s",
                      }}
                    >
                      <IconArrowUpRight size={16} stroke={1.75} />
                    </span>
                  </Link>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      aspectRatio: "16 / 10",
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={tab.image}
                      alt={`${tab.label} app screenshot`}
                      crossOrigin="anonymous"
                      style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </GridInner>
    </PageSection>
  );
}
