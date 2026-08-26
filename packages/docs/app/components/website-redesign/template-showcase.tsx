import {
  IconArrowUpRight,
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import { ImgPlaceholder } from "./ds/img-placeholder";
import { GridInner, PageSection } from "./page-grid";

interface ShowcaseApp {
  slug: string;
  name: string;
  description: string;
  image: string;
  href: string;
}

const APPS: ShowcaseApp[] = [
  {
    slug: "clips",
    name: "Clips",
    description:
      "Screen recordings with browser debug capture, calendar-synced meeting notes, and Fn-hold voice dictation — all transcribed, summarized, and searchable, with an agent that can edit any of it.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fab7beeb1f62548fab6e2a710d880a20c?format=webp&width=800",
    href: "/apps/clips",
  },
  {
    slug: "design",
    name: "Design",
    description:
      "Agent-native HTML prototyping studio. Generate interactive Alpine/Tailwind designs, compare variants, refine live tweak controls, and export the result.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F75026532fe204acbab72d41dbeb34305?format=webp&width=800&height=1200",
    href: "/apps/design",
  },
  {
    slug: "slides",
    name: "Slides",
    description:
      "Generate full presentations from a prompt. Edit visually or conversationally. AI image generation, 8 layouts, and presentation mode built in.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4b196d8d24c44914a021d1577f10879b",
    href: "/apps/slides",
  },
  {
    slug: "analytics",
    name: "Analytics",
    description:
      "Connect any data source, prompt for any chart, build reusable dashboards. The agent writes SQL, generates visualizations, and evolves the app.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fcf9102c2aa3b4de982a50ab88d07b6df",
    href: "/apps/analytics",
  },
  {
    slug: "calendar",
    name: "Calendar",
    description:
      "Full calendar with Google sync, availability management, and a public booking page. The agent finds open slots, creates events, and manages your schedule.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd43810da66d44bfc96b21255b93d4ccb",
    href: "/apps/calendar",
  },
  {
    slug: "mail",
    name: "Mail",
    description:
      "Superhuman-style email client with keyboard shortcuts, AI triage, multi-account support, and email automations. Own your inbox workflow.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F84818cf9e2fa448b84fb9f91b6f1f80b",
    href: "/apps/mail",
  },
  {
    slug: "assets",
    name: "Assets",
    description:
      "Digital asset manager for uploads, brand libraries, searchable references, and on-brand image/video generation that other apps can call through A2A or embed as a picker.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F9fdd5469051f421db5f1fdcc749de66b?format=webp&width=800&height=1200",
    href: "/apps/assets",
  },
  {
    slug: "content",
    name: "Content",
    description:
      "Edit local Markdown/MDX files like Obsidian, generate rich interactive custom blocks, and use an AI agent to draft, rewrite, and publish.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa70f7bcdb3744d8291eb607bfda36ab0",
    href: "/apps/content",
  },
  {
    slug: "chat",
    name: "Chat",
    description:
      "Chat-first app scaffold with durable threads, a standard sidebar, actions, auth, live sync, and a clean path to add screens or plug in your own agent backend.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F65323b4e4425484ab680ae3c158fd63d",
    href: "/apps/chat",
  },
  {
    slug: "dispatch",
    name: "Dispatch",
    description:
      "Centralized messaging and management for every agent in your stack. Talk to your agents from Slack, Telegram, or the web; route jobs, hold memory, approve actions, and delegate across apps over A2A.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fea3f73fdf23240009ef0be82f7edc0fb",
    href: "/apps/dispatch",
  },
  {
    slug: "forms",
    name: "Forms",
    description:
      "Agent-native form builder. Generate forms from a prompt, edit fields visually or conversationally, and send submissions to Slack, Discord, Google Sheets, or webhooks.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fdae3c94347a248e385ab9981ec7921ac",
    href: "/apps/forms",
  },
  {
    slug: "plan",
    name: "Plan",
    description:
      "Install visual planning as an app-backed skill. Your coding agent can open structured plans with diagrams, wireframes, prototypes, annotations, comments, and shareable review links.",
    image:
      "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc56ca318901149dbb0cdadea94946c11",
    href: "/apps/plan",
  },
];

// Matches the site header's icon-button treatment (40x40, secondary border,
// secondary hover) so the carousel controls read as part of the same system.
function CarouselIconButton({
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className="border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
      style={{
        width: 40,
        height: 40,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: "var(--b-radius)",
        background: "transparent",
        color: "var(--b-text-primary)",
        cursor: "pointer",
        outline: "none",
        transition: "background 0.15s, border-color 0.15s",
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TemplateShowcase() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  function updateScrollState() {
    const el = viewportRef.current;
    if (!el) return;
    setCanScrollPrev(el.scrollLeft > 4);
    setCanScrollNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateScrollState();
  }, []);

  function scrollByPage(direction: 1 | -1) {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * el.clientWidth * 0.9,
      behavior: "smooth",
    });
  }

  return (
    <PageSection>
      <GridInner
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-6)",
          padding: "var(--spacing-40) var(--spacing-8) var(--spacing-20)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-heading-2)",
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "var(--b-text-primary)",
          }}
        >
          What can you build with Agent-Native?
        </h2>
        <p
          style={{
            margin: 0,
            maxWidth: 633,
            fontFamily: "var(--b-font-sans)",
            fontSize: "var(--b-t-paragraph-1)",
            lineHeight: 1.4,
            color: "var(--b-text-secondary)",
          }}
        >
          Start with chat, a focused internal tool, or a complete
          customer-facing product. Every app gives users a UI and agents the
          tools to do the same work.
        </p>
      </GridInner>

      <GridInner
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--spacing-2)",
          padding: "0 var(--spacing-8) var(--spacing-4)",
        }}
      >
        <CarouselIconButton
          aria-label="Scroll apps left"
          onClick={() => scrollByPage(-1)}
          disabled={!canScrollPrev}
        >
          <IconChevronLeft size={18} stroke={1.5} />
        </CarouselIconButton>
        <CarouselIconButton
          aria-label="Scroll apps right"
          onClick={() => scrollByPage(1)}
          disabled={!canScrollNext}
        >
          <IconChevronRight size={18} stroke={1.5} />
        </CarouselIconButton>
      </GridInner>

      <GridInner>
        <div
          ref={viewportRef}
          className="app-carousel-viewport"
          onScroll={updateScrollState}
        >
          <div className="app-carousel-track">
            {APPS.map((app) => (
              <Link key={app.slug} to={app.href} className="app-carousel-card">
                <div className="app-carousel-card-image">
                  <ImgPlaceholder
                    aspectRatio="320 / 256"
                    label=""
                    rounded={false}
                    background="var(--b-bg-raised)"
                    bordered={false}
                  />
                </div>
                <div className="app-carousel-card-body">
                  <h3
                    style={{
                      margin: 0,
                      fontFamily: "var(--b-font-sans)",
                      fontSize: "var(--b-t-heading-5)",
                      fontWeight: 500,
                      lineHeight: 1.15,
                      letterSpacing: "-0.02em",
                      color: "var(--b-text-primary)",
                    }}
                  >
                    {app.name}
                  </h3>
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "var(--b-font-sans)",
                      fontSize: "var(--b-t-paragraph-2)",
                      lineHeight: 1.4,
                      color: "var(--b-text-secondary)",
                    }}
                  >
                    {app.description}
                  </p>
                  <span
                    aria-hidden="true"
                    className="template-showcase-arrow app-carousel-card-arrow"
                  >
                    <IconArrowUpRight size={16} stroke={1.75} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </GridInner>
    </PageSection>
  );
}
