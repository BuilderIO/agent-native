import { ImgPlaceholder } from "./ds/img-placeholder";
import { GridInner, PageSection } from "./page-grid";

interface Pillar {
  title: string;
  description?: string;
  image?: string;
  darkImage?: string;
  lightImage?: string;
}

const PILLAR_ROWS: Pillar[][] = [
  [
    {
      title: "React UI",
      description:
        "Give users familiar screens for browsing, editing, and reviewing work.",
      darkImage:
        "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa06ad4fe59284a74a990a1f7002eece4",
      lightImage:
        "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9bcf96ce33d84249ab3b1615e713d38e",
    },
    {
      title: "Embedded agent chat",
      description:
        "Let users delegate work, ask questions, and review results without leaving the app.",
      darkImage:
        "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3f97027653004b2da9ac0a7ddbe2e01b",
      lightImage:
        "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F78ea47b65fa840b4b40a65c9ccc443f6",
    },
    {
      title: "Shared application state",
      description:
        "The agent knows what users are viewing, selecting, and editing.",
      darkImage:
        "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4d4986fc4c2447d0b39260aa65df823a",
      lightImage:
        "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ff291129737ef48c9a77badc32c1d9df8",
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
      description:
        "Run agent work automatically on schedules or application events.",
    },
  ],
  [
    {
      title: "Agent teams",
      description:
        "Delegate work to specialist agents within the app or across apps.",
    },
    {
      title: "Authentication and organizations",
      description:
        "Sign-in, user accounts, and organization membership are built in.",
    },
    {
      title: "Sharing and permissions",
      description:
        "Control who can view, comment, edit, or manage every resource.",
    },
  ],
];

export function BuiltInFeatures() {
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
          Built into every Agent-Native app
        </h2>
        <p
          style={{
            margin: 0,
            maxWidth: 633,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-paragraph-1)",
            lineHeight: 1.4,
            color: "var(--b-text-secondary)",
            textWrap: "pretty",
          }}
        >
          Everything users and AI agents need to work together, already wired
          into one application.
        </p>
      </GridInner>

      <GridInner>
        <div
          style={{
            border: "1px solid var(--b-border-subtle)",
            borderTop: "none",
          }}
        >
          {PILLAR_ROWS.map((row, rowIndex) => (
            <div
              key={row.map((pillar) => pillar.title).join("-")}
              style={{ borderTop: "1px solid var(--b-border-subtle)" }}
            >
              <div className="pillars-grid" style={{ display: "grid" }}>
                {row.map((pillar) => (
                  <div
                    key={pillar.title}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      background: "var(--b-bg-page)",
                    }}
                  >
                    {rowIndex === 0 &&
                      (pillar.darkImage && pillar.lightImage ? (
                        <div
                          className="pillar-media-spacing"
                          style={{ position: "relative" }}
                        >
                          <img
                            className="theme-img-dark"
                            src={pillar.darkImage}
                            alt=""
                            crossOrigin="anonymous"
                            loading="lazy"
                            decoding="async"
                            style={{
                              position: "relative",
                              width: "100%",
                              aspectRatio: "104 / 75",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                          <img
                            className="theme-img-light"
                            src={pillar.lightImage}
                            alt=""
                            crossOrigin="anonymous"
                            loading="lazy"
                            decoding="async"
                            style={{
                              position: "absolute",
                              inset: 0,
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                        </div>
                      ) : pillar.image ? (
                        <img
                          src={pillar.image}
                          alt=""
                          crossOrigin="anonymous"
                          loading="lazy"
                          decoding="async"
                          style={{
                            width: "100%",
                            aspectRatio: "104 / 75",
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
                      {pillar.description && (
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
                      )}
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
