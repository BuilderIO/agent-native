import { ImgPlaceholder } from "./ds/img-placeholder";
import { GridInner, PageSection } from "./page-grid";

interface Pillar {
  title: string;
  description: string;
  image?: string;
}

const PILLAR_ROWS: Pillar[][] = [
  [
    {
      title: "React UI",
      description: "Give users familiar screens for browsing, editing, and reviewing work.",
      image: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F30ea21dfcd2445678458fb256063a794",
    },
    {
      title: "Embedded agent chat",
      description: "Let users delegate work, ask questions, and review results without leaving the app.",
      image: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F08e92cf529774b4e9f46f3ce41ed3509",
    },
    {
      title: "Shared application state",
      description: "The agent knows what users are viewing, selecting, and editing.",
      image: "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fae66a78a3f6b42ae91b70007d2737d59",
    },
  ],
  [
    {
      title: "Shared SQL data",
      description: "Users and agents read and update the same source of truth.",
    },
    {
      title: "Skills and memory",
      description: "Give agents reusable expertise and persistent context.",
    },
    {
      title: "Automations",
      description: "Run agent work automatically on schedules or application events.",
    },
  ],
  [
    {
      title: "Agent teams",
      description: "Delegate work to specialist agents within the app or across apps.",
    },
    {
      title: "Authentication and organizations",
      description: "Sign-in, user accounts, and organization membership are built in.",
    },
    {
      title: "Sharing and permissions",
      description: "Control who can view, comment, edit, or manage every resource.",
    },
  ],
];

export function BuiltInFeatures() {
  return (
    <PageSection style={{ borderTop: "1px solid var(--b-border-default)" }}>
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-6)",
          padding: "var(--spacing-40) var(--spacing-8) var(--spacing-20)",
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
          Built into every Agent-Native app
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
          Everything users and AI agents need to work together, already wired into one
          application.
        </p>
      </GridInner>

      <GridInner>
        <div style={{ border: "1px solid var(--b-border-default)", borderTop: "none" }}>
          {PILLAR_ROWS.map((row, rowIndex) => (
            <div
              key={row.map((pillar) => pillar.title).join("-")}
              style={{ borderTop: "1px solid var(--b-border-default)" }}
            >
              <div
                className="pillars-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 1,
                  background: "var(--b-border-default)",
                }}
              >
                {row.map((pillar) => (
                  <div
                    key={pillar.title}
                    style={{ display: "flex", flexDirection: "column", background: "var(--b-bg-page)" }}
                  >
                    {rowIndex === 0 &&
                      (pillar.image ? (
                        <img
                          src={pillar.image}
                          alt=""
                          crossOrigin="anonymous"
                          style={{
                            width: "100%",
                            aspectRatio: "104 / 75",
                            borderRadius: "var(--b-radius)",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      ) : (
                        <ImgPlaceholder aspectRatio="104 / 75" label="" />
                      ))}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--spacing-2)",
                        padding: "var(--spacing-8)",
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
                        {pillar.title}
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
                        {pillar.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </GridInner>
    </PageSection>
  );
}
