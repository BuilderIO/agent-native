import { useT } from "@agent-native/core/client/i18n";

import { BuilderImage } from "../builder-image";
import { GridInner, PageSection } from "./page-grid";

const GRID_CELLS = Array.from({ length: 9 });

export function FeaturesActions() {
  const t = useT();
  const diagramAlt = t("homepage.actions.diagramAlt");

  return (
    <PageSection>
      <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
        <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
          {t("homepage.actions.title")}
        </h2>
        <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
          {t("homepage.actions.bodyLine1")}
          <br />
          {t("homepage.actions.bodyLine2")}
        </p>
      </GridInner>

      <GridInner className="border-t border-solid border-[var(--b-border-default)] bg-[var(--b-bg-surface)]">
        <div
          aria-hidden="true"
          className="absolute inset-0 grid grid-cols-3 grid-rows-3"
        >
          {GRID_CELLS.map((_, i) => (
            <div
              key={i}
              className={[
                "border-solid border-[var(--b-border-subtle)]",
                i % 3 !== 2 && "border-r",
                i < 6 && "border-b",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>

        <BuilderImage
          className="theme-img-dark relative h-auto w-full border-x border-solid border-[var(--b-border-subtle)]"
          src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe77f7df4d30242f19b5a06734894d77c"
          alt={diagramAlt}
          crossOrigin="anonymous"
          sizes="(max-width: 1300px) 100vw, 1300px"
          loading="lazy"
          decoding="async"
        />
        <BuilderImage
          className="theme-img-light absolute inset-0 h-full w-full border-x border-solid border-[var(--b-border-subtle)]"
          src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc95a9b87994647dea864d262117b3dfb"
          alt={diagramAlt}
          crossOrigin="anonymous"
          sizes="(max-width: 1300px) 100vw, 1300px"
          loading="lazy"
          decoding="async"
        />
      </GridInner>
    </PageSection>
  );
}
