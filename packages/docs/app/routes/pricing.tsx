import { useLocale, useT } from "@agent-native/core/client/i18n";
import { type ReactNode } from "react";
import { Link } from "react-router";

import { sitePathForLocale } from "../components/docs-locale";
import { withDefaultSocialImage } from "../seo";

const FREE_ITEMS = [
  "All current and future app templates — Clips, Plans, Design, Slides, etc.",
  "Every action surface: UI, agent tools, HTTP, MCP, A2A, CLI",
  "Unlimited users, unlimited apps, unlimited environments",
  "Self-host anywhere",
  "Fork it, modify it, ship it, charge money for what you build. Really!",
];

const FAQS: Array<{ question: string; answer: ReactNode }> = [
  {
    question: "What's the catch?",
    answer:
      "The framework is MIT licensed. We make money if you choose our backend. That's the whole business model.",
  },
  {
    question: "Will you change the license later?",
    answer:
      "We could change it for future versions. We cannot revoke it on code you already have — that's not how MIT works, and the fork you make today stays yours forever.",
  },
  {
    question: "Do I have to use Builder's backend?",
    answer: "No.",
  },
  {
    question: "Can I sell what I build with this?",
    answer: "Yes. You don't owe us anything.",
  },
  {
    question: "Is there a free trial?",
    answer: "There's a free forever.",
  },
  {
    question:
      "How is this different from a free tier that turns into $40/seat?",
    answer:
      "It's open source. All the code is on Github. Go ahead and copy it. Please.",
  },
];

export const meta = () =>
  withDefaultSocialImage([
    { title: "Pricing — Agent-Native" },
    {
      name: "description",
      content:
        "Agent-Native is MIT licensed and free for unlimited users, apps, and environments. Pay only for the infrastructure you choose.",
    },
  ]);

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`border-t border-[var(--docs-border)] py-16 sm:py-24 ${className}`}
    >
      {children}
    </section>
  );
}

export default function PricingPage() {
  const { locale } = useLocale();
  const t = useT();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

  return (
    <main className="mx-auto w-full max-w-[1120px] overflow-x-clip px-6">
      <header className="flex min-h-[72vh] flex-col justify-center py-20 sm:py-28">
        <div className="mb-8 inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-sm font-medium text-[var(--fg-secondary)]">
          <span aria-hidden className="font-mono text-[10px] opacity-70">
            $
          </span>
          Pricing
        </div>
        <h1 className="m-0 text-[clamp(7rem,24vw,18rem)] font-bold leading-[0.72] tracking-[-0.09em] text-[var(--fg)]">
          Zero
        </h1>
        <p className="mt-12 max-w-3xl text-base leading-7 text-[var(--fg-secondary)] sm:text-lg sm:leading-8">
          Agent-Native is MIT licensed. Every feature, every template, unlimited
          seats, no credit meter.
          <span className="block">
            Everything below this line is us telling you what does cost money.
          </span>
        </p>
      </header>

      <Section id="free">
        <div className="grid gap-10 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] md:gap-20">
          <h2 className="m-0 text-3xl font-bold tracking-tight sm:text-5xl">
            What's free
          </h2>
          <ul className="m-0 list-none divide-y divide-[var(--docs-border)] p-0 text-lg leading-8 text-[var(--fg)]">
            {FREE_ITEMS.map((item) => (
              <li key={item} className="py-4 first:pt-0">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="fine-print">
        <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-5xl">
          The fine print.
        </h2>
        <p className="mb-12 text-xl font-medium text-[var(--fg-secondary)] sm:text-2xl">
          We made it bigger so nobody has to squint.
        </p>
        <div className="max-w-4xl space-y-12 text-lg leading-8 text-[var(--fg-secondary)] sm:text-xl sm:leading-9">
          <div>
            <h3 className="mb-3 text-xl font-bold text-[var(--fg)] sm:text-2xl">
              AI tokens are not free.
            </h3>
            <p className="m-0">
              Your agent runs on your API key — Anthropic, OpenAI, whoever you
              already pay. That bill goes to you, and we never see it, touch it,
              or mark it up. If you're already on a Claude or ChatGPT
              subscription, you're already paid up. If you're not, expect
              roughly what your agent normally costs you, because it is your
              agent doing its normal thing.
            </p>
          </div>
          <div>
            <h3 className="mb-3 text-xl font-bold text-[var(--fg)] sm:text-2xl">
              2. Hosting is not free (unless it is).
            </h3>
            <p className="m-0">
              It runs on your laptop for nothing. It runs on a $5 VPS for $5. We
              don't host it for you unless you ask us to — see below.
            </p>
          </div>
          <div>
            <h3 className="mb-3 text-xl font-bold text-[var(--fg)] sm:text-2xl">
              3. There's an easy button that costs money.
            </h3>
            <p className="m-0">
              There are &quot;all in one&quot; back-ends that cover agent
              tokens, storage, databases, deploys, and auth seamlessly within
              Agent-Native. You can simply turn on{" "}
              <a
                href="https://www.builder.io/m/pricing"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--fg)] underline underline-offset-4"
              >
                Builder.io
              </a>{" "}
              or configure another all-in-one provider within your app settings
              after logging in.
            </p>
          </div>
        </div>
      </Section>

      <Section id="faq">
        <h2 className="mb-10 text-3xl font-bold tracking-tight sm:text-5xl">
          FAQ
        </h2>
        <div className="divide-y divide-[var(--docs-border)] border-y border-[var(--docs-border)]">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group py-1">
              <summary className="cursor-pointer py-5 pr-6 text-lg font-medium text-[var(--fg)] marker:text-[var(--fg-secondary)]">
                {faq.question}
              </summary>
              <div className="max-w-3xl pb-6 text-base leading-7 text-[var(--fg-secondary)]">
                {faq.question === "Do I have to use Builder's backend?" ? (
                  <p className="m-0">
                    No. Read the{" "}
                    <Link
                      to={localizedPath("/docs/database")}
                      className="text-[var(--fg)] underline underline-offset-4"
                    >
                      adapter docs
                    </Link>
                    .
                  </p>
                ) : (
                  <p className="m-0">{faq.answer}</p>
                )}
              </div>
            </details>
          ))}
        </div>
      </Section>

      <Section id="updates" className="text-center">
        <h2 className="mx-auto mb-5 max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          {t("home.hero.titleLine1")} {t("home.hero.titleAccent")}
        </h2>
        <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-[var(--fg-secondary)]">
          {t("home.hero.body")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link to={localizedPath("/apps")} className="primary-button">
            {t("home.hero.primaryCta")} <span aria-hidden>→</span>
          </Link>
          <Link to={localizedPath("/docs")} className="secondary-button">
            {t("home.hero.secondaryCta")}
          </Link>
        </div>
      </Section>
    </main>
  );
}
