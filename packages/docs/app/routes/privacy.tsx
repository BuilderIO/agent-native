import type { ReactNode } from "react";
import { withDefaultSocialImage } from "../seo";

const UPDATED_AT = "June 23, 2026";

const DATA_CATEGORIES = [
  {
    title: "Account and workspace information",
    body: "Name, email address, organization membership, authentication identifiers, and app settings used to sign you in and keep hosted workspaces separated.",
  },
  {
    title: "Hosted application content",
    body: "Content you create or upload in hosted Agent-Native templates, such as recordings, transcripts, documents, comments, tasks, prompts, agent responses, files, and configuration.",
  },
  {
    title: "Connected integration data",
    body: "Data from services you choose to connect, such as calendar, Slack, email, storage, or developer tools, limited to the scopes and workflows shown in the hosted app.",
  },
  {
    title: "Usage and technical data",
    body: "Device, browser, IP address, diagnostic logs, page and feature usage, errors, and security events used to operate, secure, and improve hosted services.",
  },
];

const USES = [
  "Provide, sync, and operate hosted Agent-Native applications and their agent workflows.",
  "Record, transcribe, summarize, search, share, or transform content when you ask the hosted app to do so.",
  "Authenticate users, manage organizations, enforce access controls, and prevent abuse.",
  "Debug incidents, provide support, measure reliability, and improve the hosted product experience.",
  "Comply with legal, security, and platform obligations.",
];

export const meta = () =>
  withDefaultSocialImage([
    {
      title: "Privacy Policy - Agent-Native hosted applications",
    },
    {
      name: "description",
      content:
        "Privacy policy for Agent-Native hosted applications, templates, and browser extensions.",
    },
    {
      property: "og:title",
      content: "Privacy Policy - Agent-Native hosted applications",
    },
    {
      property: "og:description",
      content:
        "How Agent-Native hosted applications collect, use, share, and retain data.",
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

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[980px] px-6 py-14 sm:py-20">
      <header className="mb-10">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--fg-secondary)]">
          Privacy Policy
        </p>
        <h1 className="mb-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] sm:text-5xl">
          Agent-Native hosted applications
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-[var(--fg-secondary)]">
          This policy explains how Builder.io collects, uses, shares, and
          retains data when it operates Agent-Native hosted applications, hosted
          templates, demos, and official browser extensions.
        </p>
        <p className="mt-4 text-sm text-[var(--fg-secondary)]">
          Last updated: {UPDATED_AT}
        </p>
      </header>

      <div className="mb-10 grid gap-4 md:grid-cols-3">
        <ScopeCard
          title="Hosted apps"
          body="Covered when Builder.io operates the Agent-Native service or hosted template for you."
        />
        <ScopeCard
          title="Open source"
          body="Not covered for your use of the MIT-licensed source code itself."
        />
        <ScopeCard
          title="Self-hosted"
          body="Not covered for forks, customizations, or deployments operated by someone else."
        />
      </div>

      <Section title="Scope">
        <p>
          Agent-Native is open source, and the source code is available under
          the MIT license. This policy applies only to hosted applications and
          services operated by Builder.io for Agent-Native users. It does not
          apply to someone else&apos;s use of the code, including forks,
          customized templates, private deployments, or self-hosted versions. If
          you operate your own deployment, you are responsible for your own data
          practices and privacy policy.
        </p>
        <p>
          This policy is intended to supplement Builder.io&apos;s broader{" "}
          <a
            href="https://www.builder.io/legal/privacy"
            className="font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]"
          >
            Privacy Policy
          </a>{" "}
          for Agent-Native hosted application behavior.
        </p>
      </Section>

      <Section title="Information we collect">
        <div className="grid gap-4 md:grid-cols-2">
          {DATA_CATEGORIES.map((category) => (
            <article
              key={category.title}
              className="rounded-lg border border-[var(--docs-border)] p-5"
            >
              <h3 className="mb-2 text-base font-semibold text-[var(--fg)]">
                {category.title}
              </h3>
              <p className="m-0 text-sm leading-6">{category.body}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        id="clips-chrome-extension"
        title="Agent-Native Clips Chrome extension"
      >
        <p>
          The Agent-Native Clips Chrome extension helps you start browser-based
          recordings and, when enabled, attach browser diagnostics to a clip. It
          may collect the selected capture source, camera and microphone media
          you choose to include, the active tab title and URL, and
          authentication state needed to connect the extension to hosted Clips.
        </p>
        <p>
          Developer logs are optional. When enabled, the extension may collect
          redacted console messages, JavaScript exceptions, and fetch/XHR
          metadata such as method, URL, status, timing, and failure details from
          the selected tab while a recording is active. The extension is not
          designed to collect request bodies, response bodies, cookies, or
          authorization headers.
        </p>
        <p>
          For Chrome Web Store disclosures, use this section as the extension
          privacy-policy anchor:{" "}
          <code className="rounded border border-[var(--code-border)] bg-[var(--code-bg)] px-1.5 py-0.5 text-sm text-[var(--fg)]">
            https://www.agent-native.com/privacy#clips-chrome-extension
          </code>
          .
        </p>
      </Section>

      <Section title="How we use information">
        <ul className="m-0 list-disc space-y-2 pl-5">
          {USES.map((use) => (
            <li key={use}>{use}</li>
          ))}
        </ul>
      </Section>

      <Section title="Sharing and third parties">
        <p>
          We do not sell Agent-Native hosted application data or use it for
          third-party advertising. We share data with service providers that
          help operate the hosted service, such as cloud infrastructure,
          storage, authentication, email, observability, AI, and transcription
          providers, when those services are needed for the feature you use.
        </p>
        <p>
          When you connect an integration, the hosted app may send data to or
          receive data from that provider according to your configuration and
          the provider&apos;s own terms. We may also disclose information when
          required for security, abuse prevention, legal compliance, or to
          protect users and the service.
        </p>
      </Section>

      <Section title="Chrome Web Store limited use">
        <p>
          For the Agent-Native Clips Chrome extension, our use of information
          received from Chrome extension APIs adheres to the Chrome Web Store
          User Data Policy, including the Limited Use requirements. Browser
          activity collected by the extension is used to provide the user-facing
          recording and diagnostics workflow, not for advertising, resale,
          credit-worthiness, or unrelated profiling.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          We retain hosted application data for as long as needed to provide the
          service, maintain workspace history, comply with obligations, resolve
          disputes, or improve reliability and security. Users can delete clips,
          documents, resources, and other hosted app content through the
          relevant application controls where available.
        </p>
        <p>
          Deleted content may remain in backups, logs, or audit records for a
          limited period before it is removed according to operational retention
          schedules.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use reasonable administrative, technical, and organizational
          safeguards designed to protect hosted application data, including
          access controls, transport encryption, monitoring, and operational
          security practices. No online service can guarantee perfect security,
          so users should avoid including secrets or sensitive information in
          recordings or prompts unless they intend to share that information
          with the hosted application.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We may update this policy as Agent-Native hosted applications change.
          The updated date at the top of the page shows when the policy was last
          revised.
        </p>
        <p>
          For privacy requests or questions, contact Builder.io through the
          support and privacy channels listed in the{" "}
          <a
            href="https://www.builder.io/legal/privacy"
            className="font-medium text-[var(--fg)] underline decoration-[var(--docs-border)] underline-offset-4 transition hover:text-[var(--docs-accent)]"
          >
            Builder.io Privacy Policy
          </a>
          .
        </p>
      </Section>
    </main>
  );
}
