import {
  IconArrowUpRight,
  IconBrandLinkedin,
  IconChartBar,
  IconFileDescription,
  IconGauge,
  IconLayoutDashboard,
  IconMail,
  IconSend,
  IconStack2,
  IconUserCircle,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

import { templates, type Template } from "../toolkit/template-data";

type IconProps = { size?: number; stroke?: number };
type TemplateIcon = ComponentType<IconProps>;

const icons: Record<string, TemplateIcon> = {
  "account-tiering": IconChartBar,
  "call-follow-up-drafter": IconMail,
  "win-loss-memo": IconFileDescription,
  "churn-early-warning": IconGauge,
  "account-expert": IconUserCircle,
  "demo-clip-library": IconVideo,
  "outbound-in-your-voice": IconSend,
  "linkedin-signal-watch": IconBrandLinkedin,
  "linkedin-icp-prospect-tracker": IconUsers,
  "agent-advisor": IconStack2,
};

const featured = templates.filter(
  (template) => template.slug !== "agent-advisor",
);

function TemplateIcon({ template }: { template: Template }) {
  const Icon = icons[template.slug] ?? IconLayoutDashboard;
  return <Icon size={18} stroke={1.8} />;
}

export default function App() {
  return (
    <div className="catalog-shell">
      <aside className="catalog-sidebar">
        <a className="catalog-brand" href="./">
          <span className="catalog-brand-mark">A</span>
          <span>
            <small>AGENT-NATIVE</small>
            <strong>COMMUNITY</strong>
          </span>
        </a>
        <div className="catalog-sidebar-title">Community apps</div>
        <nav className="catalog-nav" aria-label="Community apps">
          <a className="catalog-nav-item is-selected" href="./">
            <IconLayoutDashboard size={16} />
            <span>All apps</span>
          </a>
          <a className="catalog-nav-item" href="./apps/agent-advisor/">
            <IconStack2 size={16} />
            <span>Agent Advisor</span>
          </a>
        </nav>
        <div className="catalog-sidebar-footer">
          <span className="mini-avatar">S</span>
          <span>
            <strong>Steve&apos;s workspace</strong>
            <small>Builder-ready starters</small>
          </span>
        </div>
      </aside>
      <main className="catalog-main">
        <header className="catalog-topbar">
          <span>Community apps</span>
          <span className="catalog-status">
            <span className="status-dot" /> Local sample data
          </span>
        </header>
        <section className="catalog-content">
          <div className="catalog-heading">
            <div>
              <span className="catalog-kicker">GEOFF&apos;S SHORTLIST</span>
              <h1>Cloneable GTM apps</h1>
            </div>
            <a className="catalog-advisor-link" href="./apps/agent-advisor/">
              <IconStack2 size={16} />
              Find a workflow to automate
              <IconArrowUpRight size={15} />
            </a>
          </div>
          <div className="catalog-grid">
            {featured.map((template) => (
              <a
                className={`catalog-card accent-card-${template.accent}`}
                href={`./apps/${template.slug}/`}
                key={template.slug}
              >
                <div className="catalog-card-top">
                  <span className="catalog-icon">
                    <TemplateIcon template={template} />
                  </span>
                  <IconArrowUpRight className="catalog-card-arrow" size={16} />
                </div>
                <h2>{template.title}</h2>
                <div className="catalog-card-meta">
                  <span>{template.audience}</span>
                  <span>{template.systems.join(" · ")}</span>
                </div>
                <div className="catalog-card-footer">
                  <span>Open app</span>
                  <span className="catalog-card-mode">{template.mode}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
