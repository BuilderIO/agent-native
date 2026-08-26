import { BuilderImage } from "../builder-image";
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
      <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
        <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
          Built into every Agent-Native app
        </h2>
        <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-pretty text-[var(--b-text-secondary)]">
          Everything users and AI agents need to work together, already wired
          into one application.
        </p>
      </GridInner>

      <GridInner>
        <div className="border-x border-b border-solid border-[var(--b-border-subtle)]">
          {PILLAR_ROWS.map((row, rowIndex) => (
            <div
              key={row.map((pillar) => pillar.title).join("-")}
              className="border-t border-solid border-[var(--b-border-subtle)]"
            >
              <div className="pillars-grid grid">
                {row.map((pillar) => (
                  <div
                    key={pillar.title}
                    className="flex flex-col bg-[var(--b-bg-page)]"
                  >
                    {rowIndex === 0 &&
                      (pillar.darkImage && pillar.lightImage ? (
                        <div className="pillar-media-spacing relative">
                          <BuilderImage
                            className="theme-img-dark relative block aspect-[104/75] w-full object-cover"
                            src={pillar.darkImage}
                            alt=""
                            crossOrigin="anonymous"
                            sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, (max-width: 1400px) 33vw, 467px"
                            loading="lazy"
                            decoding="async"
                          />
                          <BuilderImage
                            className="theme-img-light absolute inset-0 block h-full w-full object-cover"
                            src={pillar.lightImage}
                            alt=""
                            crossOrigin="anonymous"
                            sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, (max-width: 1400px) 33vw, 467px"
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      ) : pillar.image ? (
                        <BuilderImage
                          className="block aspect-[104/75] w-full object-cover"
                          src={pillar.image}
                          alt=""
                          crossOrigin="anonymous"
                          sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, (max-width: 1400px) 33vw, 467px"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <ImgPlaceholder aspectRatio="104 / 75" label="" />
                      ))}
                    <div className="flex flex-col gap-[var(--spacing-2)] p-[var(--spacing-8)]">
                      <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-6)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                        {pillar.title}
                      </h3>
                      {pillar.description && (
                        <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
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
