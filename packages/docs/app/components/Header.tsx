import { useLocale, useT } from "@agent-native/core/client/i18n";
import { FeedbackButton } from "@agent-native/core/client/ui";
import { useState, useEffect } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

import { DEFAULT_DOCS_LOCALE, sitePathForLocale } from "./docs-locale";
import { applyFirstTouchAttributionToLink } from "./marketing-attribution";
import { templates, trackEvent } from "./TemplateCard";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";

const DOCS_FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";

const feedbackTriggerClassName =
  "inline-flex h-10 items-center justify-center rounded-md border border-[#5e5e5e] bg-[#0a0a0a] px-5 font-mono text-[14px] font-semibold uppercase leading-[1.2] tracking-[0.28px] text-[#faf9f5] transition hover:border-[var(--fg-secondary)] hover:text-white";

const TRY_NOW_CLASSNAME =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-[#00dff6] bg-[#01c8f1] px-5 font-mono text-[14px] font-semibold uppercase leading-[1.2] tracking-[0.28px] text-[#0a0a0a] no-underline transition hover:bg-[#3ad4f4] hover:no-underline";

function HamburgerIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { locale } = useLocale();
  const isHome =
    sitePathForLocale(location.pathname, DEFAULT_DOCS_LOCALE) === "/";
  const [scrolled, setScrolled] = useState(false);
  const t = useT();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

  const copySvgToClipboard = async (src: string) => {
    try {
      const response = await fetch(src);
      if (!response.ok) return;
      const svg = await response.text();
      await navigator.clipboard.writeText(svg);
    } catch {
      // Ignore clipboard failures
    }
  };

  useEffect(() => {
    if (!isHome) return;
    const onScroll = (e: Event) => {
      const target = e.target;
      let top = 0;
      if (target === document || target === window || target == null) {
        top = window.scrollY;
      } else if (target instanceof HTMLElement) {
        top = target.scrollTop;
      }
      setScrolled(top > 10);
    };
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener("scroll", onScroll, {
        capture: true,
      } as EventListenerOptions);
  }, [isHome]);

  const showHeaderBg = !isHome || scrolled;

  const closeMobileMenu = () => setMobileMenuOpen(false);
  const feedbackLabel = t("feedback.label");
  const feedbackPlaceholder = t("feedback.placeholder");

  const localizedPathname = sitePathForLocale(
    location.pathname,
    DEFAULT_DOCS_LOCALE,
  );
  const activeAppSlug = localizedPathname.match(/^\/apps\/([a-z0-9-]+)/)?.[1];
  const activeTemplate = activeAppSlug
    ? templates.find((template) => template.slug === activeAppSlug)
    : undefined;
  const tryNowHref = activeTemplate?.demoUrl ?? localizedPath("/apps");
  const tryNowLabel = t("header.tryNow");

  function handleTryNowClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (activeTemplate) applyFirstTouchAttributionToLink(event.currentTarget);
    trackEvent("click try now", {
      template: activeTemplate?.slug ?? null,
      location: "header",
    });
  }

  const tryNowButton = activeTemplate ? (
    <a
      href={tryNowHref}
      target="_blank"
      rel="noopener noreferrer"
      className={TRY_NOW_CLASSNAME}
      onClick={handleTryNowClick}
    >
      {tryNowLabel}
    </a>
  ) : (
    <Link
      data-an-prefetch="viewport"
      to={tryNowHref}
      className={TRY_NOW_CLASSNAME}
      onClick={handleTryNowClick}
    >
      {tryNowLabel}
    </Link>
  );

  return (
    <header
      className={`sticky top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        showHeaderBg
          ? "border-b border-[var(--docs-border)] bg-[rgba(10,10,10,0.90)] backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between px-6 md:px-12 lg:px-20 xl:px-24">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Link
              data-an-prefetch="viewport"
              to={localizedPath("/")}
              aria-label="Agent-Native"
              className="flex shrink-0 items-center gap-2 text-[var(--fg)] no-underline lg:w-[320px] xl:w-[380px]"
              suppressHydrationWarning
            >
              <img
                src="/agent-native-icon-light.svg"
                alt=""
                className="block h-7 w-7 min-[380px]:hidden dark:hidden"
                aria-hidden="true"
                loading="lazy"
                decoding="async"
              />
              <img
                src="/agent-native-icon-dark.svg"
                alt=""
                className="hidden h-7 w-7 dark:block min-[380px]:dark:hidden"
                aria-hidden="true"
                loading="lazy"
                decoding="async"
              />
              <img
                src="/agent-native-logo-light.svg"
                alt="Agent-Native"
                width={1286}
                height={317}
                className="hidden aspect-[1286/317] h-8 lg:h-[34px] w-auto min-[380px]:block dark:hidden"
                loading="lazy"
                decoding="async"
              />
              <img
                src="/agent-native-logo-dark.svg"
                alt="Agent-Native"
                width={1286}
                height={317}
                className="hidden aspect-[1286/317] h-8 lg:h-[34px] w-auto min-[380px]:dark:block"
                loading="lazy"
                decoding="async"
              />
            </Link>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() =>
                void copySvgToClipboard("/agent-native-icon-dark.svg")
              }
            >
              {t("header.copyLogoSvg")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                void copySvgToClipboard("/agent-native-logo-dark.svg")
              }
            >
              {t("header.copyWordmark")}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => navigate(localizedPath("/brand"))}
            >
              {t("header.brandAssets")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Desktop nav links */}
        <div className="hidden lg:flex items-center gap-1 text-[15px] font-medium">
          <NavLink
            data-an-prefetch="viewport"
            to={localizedPath("/docs")}
            className={({ isActive }) =>
              `px-2 py-1 rounded-md transition ${
                isActive
                  ? "text-[var(--fg)] font-medium"
                  : "text-[#9a9997] hover:text-[var(--fg)]"
              }`
            }
          >
            {t("header.docs")}
          </NavLink>
          <NavLink
            data-an-prefetch="viewport"
            to={localizedPath("/apps")}
            className={({ isActive }) =>
              `px-2 py-1 rounded-md transition ${
                isActive
                  ? "text-[var(--fg)] font-medium"
                  : "text-[#9a9997] hover:text-[var(--fg)]"
              }`
            }
          >
            {t("header.templates")}
          </NavLink>
          <a
            href="https://github.com/BuilderIO/agent-native"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded-md text-[#9a9997] transition hover:text-[var(--fg)]"
          >
            GitHub
          </a>
          <a
            href="https://discord.gg/qm82StQ2NC"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded-md text-[#9a9997] transition hover:text-[var(--fg)]"
          >
            Discord
          </a>
        </div>

        {/* Right actions */}
        <div className="flex shrink-0 items-center justify-end gap-3 lg:w-[320px] xl:w-[380px]">
          <FeedbackButton
            url={DOCS_FEEDBACK_URL}
            label={feedbackLabel}
            placeholder={feedbackPlaceholder}
            trigger={
              <button
                type="button"
                aria-label={feedbackLabel}
                className={`${feedbackTriggerClassName} hidden lg:inline-flex`}
              >
                {feedbackLabel}
              </button>
            }
            align="end"
            side="bottom"
          />

          {tryNowButton}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-8 w-8 shrink-0 items-center justify-center text-[var(--fg-secondary)] transition hover:text-[var(--fg)] lg:hidden"
            aria-label={t("header.toggleNavigation")}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <CloseIcon /> : <HamburgerIcon />}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[var(--docs-border)] bg-[rgba(10,10,10,0.95)] backdrop-blur-lg px-6 py-5 flex flex-col gap-4">
          <NavLink
            data-an-prefetch="viewport"
            to={localizedPath("/docs")}
            className={({ isActive }) =>
              `text-base font-medium transition ${
                isActive
                  ? "text-[var(--fg)]"
                  : "text-[#9a9997] hover:text-[var(--fg)]"
              }`
            }
            onClick={closeMobileMenu}
          >
            {t("header.docs")}
          </NavLink>
          <NavLink
            data-an-prefetch="viewport"
            to={localizedPath("/apps")}
            className={({ isActive }) =>
              `text-base font-medium transition ${
                isActive
                  ? "text-[var(--fg)]"
                  : "text-[#9a9997] hover:text-[var(--fg)]"
              }`
            }
            onClick={closeMobileMenu}
          >
            {t("header.templates")}
          </NavLink>
          <a
            href="https://github.com/BuilderIO/agent-native"
            target="_blank"
            rel="noreferrer"
            className="text-base font-medium text-[#9a9997] transition hover:text-[var(--fg)]"
          >
            GitHub
          </a>
          <a
            href="https://discord.gg/qm82StQ2NC"
            target="_blank"
            rel="noreferrer"
            className="text-base font-medium text-[#9a9997] transition hover:text-[var(--fg)]"
          >
            Discord
          </a>
          <div className="pt-2 flex flex-col gap-3">
            <FeedbackButton
              url={DOCS_FEEDBACK_URL}
              label={feedbackLabel}
              placeholder={feedbackPlaceholder}
              trigger={
                <button
                  type="button"
                  aria-label={feedbackLabel}
                  className={`${feedbackTriggerClassName} w-full`}
                >
                  {feedbackLabel}
                </button>
              }
              align="start"
              side="bottom"
            />
            {activeTemplate ? (
              <a
                href={tryNowHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`${TRY_NOW_CLASSNAME} w-full`}
                onClick={(e) => {
                  handleTryNowClick(e);
                  closeMobileMenu();
                }}
              >
                {tryNowLabel}
              </a>
            ) : (
              <Link
                data-an-prefetch="viewport"
                to={tryNowHref}
                className={`${TRY_NOW_CLASSNAME} w-full`}
                onClick={(e) => {
                  handleTryNowClick(e);
                  closeMobileMenu();
                }}
              >
                {tryNowLabel}
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
