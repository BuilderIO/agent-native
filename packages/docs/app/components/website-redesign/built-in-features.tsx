import { useT } from "@agent-native/core/client/i18n";

import { BuilderImage } from "../builder-image";
import { GridInner, PageSection } from "./page-grid";

interface Pillar {
  // Catalog id under homepage.builtIn.pillars, not display copy.
  id: string;
  image?: string;
  darkImage?: string;
  lightImage?: string;
}

const PILLARS: Pillar[] = [
  {
    id: "reactUi",
    darkImage:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa06ad4fe59284a74a990a1f7002eece4",
    lightImage:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9bcf96ce33d84249ab3b1615e713d38e",
  },
  {
    id: "agentChat",
    darkImage:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3f97027653004b2da9ac0a7ddbe2e01b",
    lightImage:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F78ea47b65fa840b4b40a65c9ccc443f6",
  },
  {
    id: "sharedState",
    darkImage:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4d4986fc4c2447d0b39260aa65df823a",
    lightImage:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ff291129737ef48c9a77badc32c1d9df8",
  },
  { id: "sharedSql" },
  { id: "skillsMemory" },
  { id: "automations" },
  { id: "agentTeams" },
  { id: "auth" },
  { id: "sharing" },
];

export function BuiltInFeatures() {
  const t = useT();

  return (
    <PageSection>
      <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
        <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
          {t("homepage.builtIn.title")}
        </h2>
        <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-pretty text-[var(--b-text-secondary)]">
          {t("homepage.builtIn.body")}
        </p>
      </GridInner>

      <GridInner>
        {/* Dividers are a 1px gap over the border color, with each cell
            painting its own page-bg on top — not per-cell border-right/
            border-bottom, so a line only ever appears between cells that
            end up adjacent regardless of column count. Illustrations are
            hidden below the 3-column layout (see mobile:hidden below), so
            every card below that is plain text — a 2-column reflow can't
            pair a tall illustrated card with a short text-only one because
            there's no illustrated card left to mismatch. */}
        <div className="grid grid-cols-3 gap-px border border-solid border-[var(--b-border-subtle)] bg-[var(--b-border-subtle)] mobile:grid-cols-2 narrow:grid-cols-1">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.id}
              className="flex flex-col bg-[var(--b-bg-page)]"
            >
              {pillar.darkImage && pillar.lightImage ? (
                // Hidden below the 3-column layout: the fixed-size heading/
                // body text doesn't shrink at narrower widths, so keeping
                // the illustration at its designed size (rather than
                // growing it to fill an ever-wider single/double-column
                // card) would still leave it oversized relative to the text.
                <div className="relative mt-[var(--spacing-8)] w-full max-w-[433px] mobile:hidden">
                  <BuilderImage
                    className="theme-img-dark relative block aspect-[104/75] w-full object-cover"
                    src={pillar.darkImage}
                    alt=""
                    crossOrigin="anonymous"
                    sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, (max-width: 1300px) 33vw, 433px"
                    loading="lazy"
                    decoding="async"
                  />
                  <BuilderImage
                    className="theme-img-light absolute inset-0 block h-full w-full object-cover"
                    src={pillar.lightImage}
                    alt=""
                    crossOrigin="anonymous"
                    sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, (max-width: 1300px) 33vw, 433px"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ) : pillar.image ? (
                <BuilderImage
                  className="block aspect-[104/75] w-full max-w-[433px] object-cover mobile:hidden"
                  src={pillar.image}
                  alt=""
                  crossOrigin="anonymous"
                  sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, (max-width: 1300px) 33vw, 433px"
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
              <div className="flex flex-col gap-[var(--spacing-2)] p-[var(--spacing-8)]">
                <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-6)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
                  {t(`homepage.builtIn.pillars.${pillar.id}.title`)}
                </h3>
                <p className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
                  {t(`homepage.builtIn.pillars.${pillar.id}.body`)}
                </p>
              </div>
            </div>
          ))}
          {/* An odd pillar count leaves the 2-column layout with one card
              alone in the final row. Left with no sibling, the empty cell
              beside it would still show the grid's own background (the
              divider color), with no card there to paint over it — a plain
              spacer, painted the same page-bg as every card, fills that
              slot instead of leaving it a mismatched color. There's no such
              gap in the 3- or 1-column layouts, so the spacer only renders
              at the 2-column breakpoint. */}
          {PILLARS.length % 2 === 1 && (
            <div
              aria-hidden="true"
              className="hidden bg-[var(--b-bg-page)] mobile:block narrow:hidden"
            />
          )}
        </div>
      </GridInner>
    </PageSection>
  );
}
