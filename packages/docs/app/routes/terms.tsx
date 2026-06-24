import type { ReactNode } from "react";
import { withDefaultSocialImage } from "../seo";

const UPDATED_AT = "June 24, 2026";

const HOSTED_SERVICE_POINTS = [
  "Create and operate hosted Agent-Native workspaces and template apps.",
  "Run agent workflows, actions, automations, and integrations you choose to use.",
  "Store hosted app content, settings, organization data, and connected-account state needed to provide the service.",
  "Measure, secure, debug, and improve hosted Agent-Native services.",
];

const ACCEPTABLE_USE = [
  "Do not use hosted Agent-Native apps to violate laws, infringe rights, or harm people or systems.",
  "Do not attempt to bypass access controls, rate limits, security boundaries, or tenant isolation.",
  "Do not upload malware, credential theft material, or content designed to disrupt the service.",
  "Do not use the service to send spam, scrape without authorization, or abuse connected providers.",
  "Do not put secrets or sensitive regulated data into hosted apps unless you are authorized and the app is appropriate for that use.",
];

export const meta = () =>
  withDefaultSocialImage([
    {
      title: "Terms of Service - Agent-Native hosted applications",
    },
    {
      name: "description",
      content:
        "Terms of Service for Agent-Native hosted applications, templates, demos, and official hosted services.",
    },
    {
      property: "og:title",
      content: "Terms of Service - Agent-Native hosted applications",
    },
    {
      property: "og:description",
      content:
        "The terms that apply when Builder.io operates Agent-Native hosted applications and template services.",
    },
  ]);

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-[var(--docs-border)] py-8"
    >
      <h2 className="mb-4 text-2xl font-semibold tracking-tight text-[var(--fg)]">
        {title}
      </h2>
      <div className="space-y-4 text-base leading-7 text-[var(--fg-secondary)]">
        {children}
      </div>
    </section>
  );
}

function ScopeCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-5">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--fg)]">
        {title}
      </h3>
      <p className="m-0 text-sm leading-6 text-[var(--fg-secondary)]">{body}</p>
    </div>
  );
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]"
    >
      {children}
    </a>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-[980px] px-6 py-14 sm:py-20">
      <header className="mb-10">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
          Terms of Service
        </p>
        <h1 className="mb-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] sm:text-5xl">
          Agent-Native hosted applications
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-[var(--fg-secondary)]">
          These terms apply when Builder.io operates Agent-Native hosted
          applications, hosted templates, demos, and official hosted services
          for you.
        </p>
        <p className="mt-4 text-sm text-[var(--fg-secondary)]">
          Last updated: {UPDATED_AT}
        </p>
      </header>

      <div className="mb-10 grid gap-4 md:grid-cols-3">
        <ScopeCard
          title="Hosted apps"
          body="Covered when you use an Agent-Native app or template operated by Builder.io."
        />
        <ScopeCard
          title="Open source"
          body="The MIT-licensed source code remains available under its open-source license."
        />
        <ScopeCard
          title="Self-hosted"
          body="Separate deployments operated by you or someone else are not Builder.io hosted services."
        />
      </div>

      <Section title="Scope and related terms">
        <p>
          Agent-Native is open source, and its source code is available under
          the MIT license. These terms apply only to hosted applications and
          services operated by Builder.io for Agent-Native users. They do not
          govern forks, custom templates, private deployments, or self-hosted
          versions operated outside Builder.io.
        </p>
        <p>
          These terms supplement Builder.io&apos;s broader{" "}
          <InlineLink href="https://www.builder.io/legal/terms">
            Terms of Service
          </InlineLink>{" "}
          and the Agent-Native{" "}
          <InlineLink href="/privacy">Privacy Policy</InlineLink>. If you use a
          hosted Agent-Native app on behalf of a company or organization, you
          represent that you have authority to accept these terms for that
          organization.
        </p>
      </Section>

      <Section title="Hosted service">
        <p>
          Builder.io may provide hosted Agent-Native applications, templates,
          demos, shared workspaces, browser extensions, and related agent
          workflows. The hosted service may be updated, limited, suspended, or
          discontinued as the product evolves.
        </p>
        <ul className="m-0 list-disc space-y-2 pl-5">
          {HOSTED_SERVICE_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Section>

      <Section title="Accounts and workspaces">
        <p>
          You are responsible for the accuracy of account information, activity
          under your account, and keeping credentials secure. Hosted
          Agent-Native apps may include organization features, invitations,
          shared resources, connected integrations, and app-specific access
          controls. Only invite users and connect services you are authorized to
          use.
        </p>
        <p>
          If you believe an account, workspace, integration, or shared resource
          has been compromised or misused, contact Builder.io support promptly.
        </p>
      </Section>

      <Section title="Your content and permissions">
        <p>
          You retain ownership of content you create, upload, record, import, or
          connect to hosted Agent-Native apps. You grant Builder.io the limited
          permission needed to host, process, transmit, display, transform,
          analyze, and store that content so the hosted app and its agent
          workflows can operate.
        </p>
        <p>
          You are responsible for having the rights and permissions needed for
          content, recordings, prompts, files, credentials, and connected
          integration data you provide to the service.
        </p>
      </Section>

      <Section title="Agents, AI outputs, and integrations">
        <p>
          Hosted Agent-Native apps can run AI agents, tools, automations, and
          provider integrations at your request. AI-generated output may be
          incomplete, inaccurate, or unsuitable for a particular use. Review
          important outputs, actions, exports, and messages before relying on
          them.
        </p>
        <p>
          When you connect third-party services, your use of those services
          remains subject to their own terms, limits, permissions, and privacy
          practices.
        </p>
      </Section>

      <Section title="Acceptable use">
        <ul className="m-0 list-disc space-y-2 pl-5">
          {ACCEPTABLE_USE.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Section>

      <Section title="Open source and self-hosting">
        <p>
          These terms do not change the open-source license for Agent-Native
          code. If you download, fork, modify, or self-host Agent-Native, the
          MIT license and the terms you set for your own deployment govern that
          use. You are responsible for security, privacy, compliance,
          operations, and user support for deployments you operate.
        </p>
      </Section>

      <Section title="Suspension and termination">
        <p>
          Builder.io may suspend or restrict access to hosted Agent-Native
          services when needed to protect users, comply with law, prevent abuse,
          address security risk, or operate the service. You may stop using the
          hosted service at any time. Some data may remain in backups, logs, or
          audit records for a limited period as described in the{" "}
          <InlineLink href="/privacy">Privacy Policy</InlineLink>.
        </p>
      </Section>

      <Section title="Disclaimers and liability">
        <p>
          Hosted Agent-Native services are provided on an as-is and as-available
          basis, subject to applicable law and any separate written agreement
          you have with Builder.io. Builder.io does not guarantee that hosted
          apps, integrations, automations, or AI outputs will be uninterrupted,
          error-free, or meet every requirement.
        </p>
        <p>
          To the maximum extent permitted by law, Builder.io&apos;s liability
          for hosted Agent-Native services is limited as described in
          Builder.io&apos;s broader{" "}
          <InlineLink href="https://www.builder.io/legal/terms">
            Terms of Service
          </InlineLink>{" "}
          or another written agreement that applies to your use.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We may update these terms as Agent-Native hosted applications change.
          The updated date at the top of the page shows when the terms were last
          revised.
        </p>
        <p>
          For questions about these terms, contact Builder.io through the
          support channels listed in Builder.io&apos;s{" "}
          <InlineLink href="https://www.builder.io/legal/terms">
            Terms of Service
          </InlineLink>
          .
        </p>
      </Section>
    </main>
  );
}
