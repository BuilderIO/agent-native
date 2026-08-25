import { IconArrowUpRight } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { TabItem } from "./ds/tab-item";
import { GridInner, PageSection } from "./page-grid";

interface ShowcaseTab {
  id: string;
  label: string;
  body: string;
  image: string;
  href: string;
}

const TABS: ShowcaseTab[] = [
  {
    id: "clips",
    label: "Clips",
    body: "Give users a familiar clip editor, and let the agent transcribe, trim, and caption footage automatically.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fab7beeb1f62548fab6e2a710d880a20c?format=webp&width=800",
    href: "/apps/clips",
  },
  {
    id: "slides",
    label: "Slides",
    body: "Build decks together — the agent drafts slides, tightens copy, and keeps every version in sync.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4b196d8d24c44914a021d1577f10879b",
    href: "/apps/slides",
  },
  {
    id: "design",
    label: "Design",
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
              display: "flex",
              borderBottom: "1px solid var(--b-border-default)",
            }}
          >
            {TABS.map((tab) => (
              <TabItem
                key={tab.id}
                active={tab.id === activeId}
                onClick={() => setActiveId(tab.id)}
              >
                {tab.label}
              </TabItem>
            ))}
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
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--spacing-4)",
                      padding: "var(--spacing-8)",
                      borderRight: "1px solid var(--b-border-subtle)",
                    }}
                  >
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
                    <Link
                      to={tab.href}
                      className="hover:text-[var(--b-text-primary)]"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontFamily: "var(--b-font-sans)",
                        fontSize: "var(--b-t-paragraph-2)",
                        fontWeight: 500,
                        color: "var(--b-text-primary)",
                        textDecoration: "none",
                      }}
                    >
                      Explore {tab.label}
                      <IconArrowUpRight size={16} />
                    </Link>
                  </div>
                  <img
                    src={tab.image}
                    alt={`${tab.label} app screenshot`}
                    crossOrigin="anonymous"
                    style={{
                      width: "100%",
                      height: "100%",
                      aspectRatio: "16 / 10",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </GridInner>
    </PageSection>
  );
}
