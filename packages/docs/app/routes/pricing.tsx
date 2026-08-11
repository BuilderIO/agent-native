import { agentNativePath } from "@agent-native/core/client/api-path";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { useState, type FormEvent, type ReactNode } from "react";
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

const COMPARISON_ROWS = [
  ["Agent tokens (your key)", "~$TK/mo", "~$TK/mo"],
  ["Storage — 200 recordings", "$TK object storage", "TK"],
  ["Compute / hosting", "$TK VPS", "included"],
  ["Monthly total", "$TK", "$TK"],
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

function UpdatesForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "joined" | "error"
  >("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    try {
      const response = await fetch(
        agentNativePath("/_agent-native/builder/branch-waitlist"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            pageUrl: window.location.href,
            source: "pricing_page",
            useCase: "agent_native_project_updates",
          }),
        },
      );
      if (!response.ok) throw new Error("Subscription failed");
      setStatus("joined");
    } catch {
      setStatus("error");
    }
  }

  if (status === "joined") {
    return (
      <p role="status" className="m-0 text-sm font-medium text-[var(--fg)]">
        You're on the list. We'll keep it useful.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-xl">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="pricing-updates-email">
          Work email
        </label>
        <input
          id="pricing-updates-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          className="min-w-0 flex-1 rounded-xl border border-[var(--docs-border)] bg-[var(--bg)] px-4 py-3 text-base text-[var(--fg)] outline-none transition placeholder:text-[var(--fg-secondary)] focus:border-[var(--fg-secondary)]"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="primary-button justify-center disabled:cursor-wait disabled:opacity-60"
        >
          {status === "submitting" ? "Signing up…" : "Get project updates"}
        </button>
      </div>
      {status === "error" ? (
        <p
          role="status"
          className="mt-3 mb-0 text-sm text-[var(--fg-secondary)]"
        >
          We couldn't sign you up just now. Please try again.
        </p>
      ) : null}
    </form>
  );
}

export default function PricingPage() {
  const { locale } = useLocale();
  const t = useT();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);
  const [users, setUsers] = useState("10");
  const userCount = Number.parseInt(users, 10) || 0;

  const setSteppedUsers = (change: number) => {
    setUsers(String(Math.max(1, userCount + change)));
  };

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
              1. Agent tokens are not free.
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
              3. If you use our backend, that costs money.
            </h3>
            <p className="m-0">
              Storage, database, deploys, and auth on Builder's infrastructure
              are a paid product. Prices are below, in the same font as
              everything else, because that's how pricing should work.
            </p>
          </div>
        </div>
      </Section>

      <Section id="builder-backend">
        <div className="mb-5 inline-flex rounded-full border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
          Optional
        </div>
        <h2 className="mb-5 text-3xl font-bold tracking-tight sm:text-5xl">
          Builder.io Back-end
        </h2>
        <p className="mb-10 max-w-3xl text-xl leading-8 text-[var(--fg-secondary)] sm:text-2xl">
          You can run all of this yourself. Here's when you'd like the Easy
          button.
        </p>
        <div className="max-w-4xl space-y-6 text-base leading-8 text-[var(--fg-secondary)] sm:text-lg">
          <p>
            Self-hosting means you own the Postgres, the object storage, the CDN
            bill, the auth flow, the backups, and the 2am page when the disk
            fills up. Some teams want that. Some teams have a product to ship.
          </p>
          <p>
            Builder's managed backend is the quicker, easier option to just
            <em> use </em>these apps, rather than build your own:
          </p>
          <div className="rounded-2xl border border-dashed border-[var(--docs-border)] bg-[var(--bg-secondary)] px-6 py-12 text-center font-mono text-sm text-[var(--fg-secondary)]">
            Pricing table placeholder
          </div>
          <p>
            Nothing you build gets locked in. The storage and data adapters are
            interfaces — swap ours out for yours and the app keeps running. If
            we ever stop being the best option, leave. We'd rather you could.
          </p>
        </div>
      </Section>

      <Section id="comparison">
        <h2 className="mb-5 text-3xl font-bold tracking-tight sm:text-5xl">
          Self-hosting vs Builder.io
        </h2>
        <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label
            htmlFor="pricing-users"
            className="font-medium text-[var(--fg)]"
          >
            Number of users
          </label>
          <div className="flex w-fit items-stretch overflow-hidden rounded-xl border border-[var(--docs-border)] bg-[var(--bg)]">
            <button
              type="button"
              aria-label="Decrease number of users"
              onClick={() => setSteppedUsers(-1)}
              className="w-11 text-xl text-[var(--fg-secondary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)]"
            >
              −
            </button>
            <input
              id="pricing-users"
              type="number"
              min="1"
              inputMode="numeric"
              value={users}
              onChange={(event) => setUsers(event.target.value)}
              onBlur={() => setUsers(String(Math.max(1, userCount)))}
              className="w-20 border-x border-y-0 border-[var(--docs-border)] bg-transparent px-2 text-center font-mono text-base text-[var(--fg)] outline-none"
            />
            <button
              type="button"
              aria-label="Increase number of users"
              onClick={() => setSteppedUsers(1)}
              className="w-11 text-xl text-[var(--fg-secondary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--fg)]"
            >
              +
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-[var(--docs-border)]">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead className="bg-[var(--bg-secondary)] text-sm text-[var(--fg-secondary)]">
              <tr>
                <th className="px-5 py-4 font-medium">Line item</th>
                <th className="px-5 py-4 font-medium">Self-hosted</th>
                <th className="px-5 py-4 font-medium">On Builder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--docs-border)] text-base text-[var(--fg)]">
              <tr>
                <td className="px-5 py-4">Agent-Native license</td>
                <td className="px-5 py-4 font-mono">$0</td>
                <td className="px-5 py-4 font-mono">$0</td>
              </tr>
              <tr>
                <td className="px-5 py-4">Seats ({userCount || 0} people)</td>
                <td className="px-5 py-4 font-mono">$0</td>
                <td className="px-5 py-4 font-mono">TK</td>
              </tr>
              {COMPARISON_ROWS.map(([label, selfHosted, builder]) => (
                <tr key={label}>
                  <td className="px-5 py-4">{label}</td>
                  <td className="px-5 py-4 font-mono">{selfHosted}</td>
                  <td className="px-5 py-4 font-mono">{builder}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <div className="mb-16 flex flex-wrap items-center justify-center gap-4">
          <Link to={localizedPath("/apps")} className="primary-button">
            {t("home.hero.primaryCta")} <span aria-hidden>→</span>
          </Link>
          <Link
            to={localizedPath("/docs")}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--docs-border)] px-6 py-3 text-sm font-medium text-[var(--fg)] no-underline transition hover:border-[var(--fg-secondary)]"
          >
            {t("home.hero.secondaryCta")}
          </Link>
        </div>

        <div className="mx-auto flex max-w-3xl flex-col items-center rounded-2xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] px-6 py-8 sm:px-10 sm:py-10">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
            Project updates
          </p>
          <h3 className="mb-3 text-2xl font-bold tracking-tight">
            One changelog for every Agent-Native product.
          </h3>
          <p className="mt-0 mb-6 max-w-xl text-base leading-7 text-[var(--fg-secondary)]">
            New templates, framework releases, backend updates, and the useful
            details behind them. One occasional email.
          </p>
          <UpdatesForm />
        </div>
      </Section>
    </main>
  );
}
