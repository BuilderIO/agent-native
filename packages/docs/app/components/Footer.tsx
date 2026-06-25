import { useLocale, useT } from "@agent-native/core/client";
import { Link } from "react-router";

import { sitePathForLocale } from "./docs-locale";

export default function Footer() {
  const year = new Date().getFullYear();
  const { locale } = useLocale();
  const t = useT();
  const localizedPath = (path: string) => sitePathForLocale(path, locale);

  return (
    <footer className="border-t border-[var(--docs-border)] px-6 py-8">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 text-sm text-[var(--fg-secondary)] sm:flex-row">
        <p className="m-0">&copy; {year} Agent-Native</p>
        <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-end">
          <Link
            to={localizedPath("/download")}
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            {t("footer.download")}
          </Link>
          <Link
            to={localizedPath("/privacy")}
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            {t("footer.privacy")}
          </Link>
          <Link
            to={localizedPath("/terms")}
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            {t("footer.terms")}
          </Link>
          <a
            href="https://github.com/BuilderIO/agent-native"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            GitHub <span className="text-[10px] opacity-50">↗</span>
          </a>
          <a
            href="https://discord.gg/qm82StQ2NC"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            Discord <span className="text-[10px] opacity-50">↗</span>
          </a>
          <a
            href="https://www.npmjs.com/package/@agent-native/core"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--fg-secondary)] transition hover:text-[var(--fg)]"
          >
            npm <span className="text-[10px] opacity-50">↗</span>
          </a>
        </div>
      </div>
    </footer>
  );
}
