import type { MouseEvent, ReactNode } from "react";

import { useSettingsShell } from "../settings/shell/context.js";
import { settingsPageHref } from "../settings/shell/routing.js";

const LINK_TOKEN = "⁣link⁣";

/**
 * Pass as the `link` value of a catalog string that holds `{{link}}`, then
 * render the result with `SentenceWithLink`, so translators keep the sentence
 * whole.
 */
export const SENTENCE_LINK_TOKEN = LINK_TOKEN;

export function SentenceWithLink({
  text,
  link,
}: {
  text: string;
  link: ReactNode;
}) {
  const [before, after = ""] = text.split(LINK_TOKEN);
  return (
    <>
      {before}
      {link}
      {after}
    </>
  );
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/** An inline link to another Settings page that routes inside the shell. */
export function SettingsPageLink({
  page,
  sub,
  children,
}: {
  page: string;
  sub?: string;
  children: ReactNode;
}) {
  const { navigate } = useSettingsShell();
  return (
    <a
      href={settingsPageHref(page, sub)}
      onClick={(event) => {
        if (isModifiedClick(event)) return;
        event.preventDefault();
        navigate(page, sub ?? null);
      }}
      className="font-medium text-foreground underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}
