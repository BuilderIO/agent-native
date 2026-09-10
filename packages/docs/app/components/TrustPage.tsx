import { useT } from "@agent-native/core/client/i18n";

type TrustPageKind = "about" | "contact";

const SECTION_KEYS = {
  about: ["project", "openSource", "hosted", "community"],
  contact: ["support", "source", "security", "legal"],
} as const;

// Cloudflare's email obfuscation rewrites the plain-text address (in the
// mailto link and in the support section's body copy) into a
// `/cdn-cgi/l/email-protection` link that 404s for crawlers that don't run
// its client-side decode script. The `email_off` comment pair is Cloudflare's
// documented opt-out for content that should stay as a real, working link.
function emailOffHtml(text: string): { __html: string } {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return { __html: `<!--email_off-->${escaped}<!--/email_off-->` };
}

export default function TrustPage({ kind }: { kind: TrustPageKind }) {
  const t = useT();
  const prefix = `legal.${kind}`;

  return (
    <main className="mx-auto w-full max-w-site px-6 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-[980px]">
        <header className="mb-10">
          <p className="mb-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
            {t(`${prefix}.eyebrow`)}
          </p>
          <h1 className="mb-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] sm:text-5xl">
            {t(`${prefix}.title`)}
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-[var(--fg-secondary)]">
            {t(`${prefix}.intro`)}
          </p>
          {kind === "contact" ? (
            <a
              href="mailto:support@builder.io"
              className="mt-5 inline-flex font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]"
              dangerouslySetInnerHTML={emailOffHtml(
                t("legal.contact.emailLabel"),
              )}
            />
          ) : null}
        </header>

        <div>
          {SECTION_KEYS[kind].map((sectionKey) => (
            <section
              key={sectionKey}
              className="scroll-mt-24 border-t border-[var(--docs-border)] py-8"
            >
              <h2 className="mb-4 text-2xl font-semibold tracking-tight text-[var(--fg)]">
                {t(`${prefix}.sections.${sectionKey}.title`)}
              </h2>
              {kind === "contact" && sectionKey === "support" ? (
                <p
                  className="m-0 text-base leading-7 text-[var(--fg-secondary)]"
                  dangerouslySetInnerHTML={emailOffHtml(
                    t(`${prefix}.sections.${sectionKey}.body`),
                  )}
                />
              ) : (
                <p className="m-0 text-base leading-7 text-[var(--fg-secondary)]">
                  {t(`${prefix}.sections.${sectionKey}.body`)}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
