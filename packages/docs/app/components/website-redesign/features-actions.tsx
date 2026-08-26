import { BuilderImage } from "../builder-image";
import { GridInner, PageSection } from "./page-grid";

const GRID_CELLS = Array.from({ length: 9 });

export function FeaturesActions() {
  return (
    <PageSection>
      <GridInner className="flex flex-col gap-[var(--spacing-6)] border-t border-solid border-[var(--b-border-default)] px-[var(--spacing-8)] pt-[var(--spacing-40)] pb-[var(--spacing-20)]">
        <h2 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-2)] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--b-text-primary)]">
          One Action powers every surface
        </h2>
        <p className="m-0 max-w-[633px] font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-1)] leading-[1.4] text-[var(--b-text-secondary)]">
          Actions are the building blocks of an Agent Native app.
          <br />
          Define functionality once, then use it from your UI, agent chat, HTTP
          API, MCP, A2A, or CLI.
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
          alt="One Action powers UI, MCP, Agent Chat, A2A, HTTP API, and CLI"
          crossOrigin="anonymous"
          sizes="(max-width: 1400px) 100vw, 1400px"
          loading="lazy"
          decoding="async"
        />
        <BuilderImage
          className="theme-img-light absolute inset-0 h-full w-full border-x border-solid border-[var(--b-border-subtle)]"
          src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2ee8d6c41d884ac08d486ba49634af1d"
          alt="One Action powers UI, MCP, Agent Chat, A2A, HTTP API, and CLI"
          crossOrigin="anonymous"
          sizes="(max-width: 1400px) 100vw, 1400px"
          loading="lazy"
          decoding="async"
        />
      </GridInner>
    </PageSection>
  );
}
