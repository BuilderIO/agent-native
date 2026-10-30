import { useT } from "@agent-native/core/client/i18n";
import { signInJourney } from "@agent-native/core/shared";
import { buildContentPublicDocumentPath } from "@shared/agent-readable";
import type {
  PublicReaderContext,
  PublicReaderPage,
} from "@shared/public-reader";
import { IconFileText, IconLayoutSidebarRight } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { ContentIcon } from "@/components/icons/ContentIcon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Where the reader's sign-in and sign-up go: the page's editor link comes
 * back after either, and opens the page for anyone who can read it.
 */
export function publicReaderSignInHrefs(documentId: string, basePath: string) {
  const signIn =
    signInJourney({
      at: `${basePath}/page/${encodeURIComponent(documentId)}`,
      basePath,
    }).signInHref ?? `${basePath}/sign-in`;
  return {
    signIn,
    signUp: `${signIn}${signIn.includes("?") ? "&" : "?"}tab=signup`,
  };
}

// The editor's breadcrumb, as links: the root, a fold for anything between,
// and the parent. A phone keeps only the parent beside the page.
function PublicReaderPath({
  ancestors,
  current,
  pageHref,
}: {
  ancestors: PublicReaderPage[];
  current: PublicReaderPage;
  pageHref: (id: string) => string;
}) {
  const t = useT();
  const untitled = t("sidebar.untitled");
  const shown =
    ancestors.length > 2
      ? [ancestors[0], null, ancestors[ancestors.length - 1]]
      : ancestors;
  return (
    <nav
      aria-label={t("publicDocument.pagePath")}
      className="flex min-w-0 flex-1 items-center text-sm text-foreground"
    >
      <ol className="flex min-w-0 items-center gap-1">
        {shown.map((page, index) => (
          <li
            key={page?.id ?? "fold"}
            className={cn(
              "min-w-0 items-center gap-1",
              index < shown.length - 1 ? "hidden sm:flex" : "flex",
              !page && "shrink-0",
            )}
          >
            {page ? (
              <a
                href={pageHref(page.id)}
                className="flex min-w-0 max-w-48 items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {page.icon ? (
                  <ContentIcon
                    value={page.icon}
                    size={14}
                    className="shrink-0"
                  />
                ) : null}
                <span className="truncate">
                  {page.title.trim() || untitled}
                </span>
              </a>
            ) : (
              <span className="px-1.5 py-1 text-muted-foreground">…</span>
            )}
            <span
              aria-hidden="true"
              className="shrink-0 text-muted-foreground/70"
            >
              /
            </span>
          </li>
        ))}
        <li className="flex min-w-[min(6rem,100%)] items-center">
          <span
            aria-current="page"
            className="flex min-w-0 max-w-56 items-center gap-1 px-1.5 py-1"
          >
            {current.icon ? (
              <ContentIcon
                value={current.icon}
                size={14}
                className="shrink-0"
              />
            ) : null}
            <span className="truncate">{current.title.trim() || untitled}</span>
          </span>
        </li>
      </ol>
    </nav>
  );
}

/**
 * The page a reader without an account sees: Content's top bar with the
 * page's public path and a way in, the page, its public sub-pages, and an
 * invitation to write their own. Every visitor gets this same HTML, so a
 * signed-in reader's version arrives only once the browser knows who they
 * are; they get Chat in place of sign-in, and no invitation.
 */
export function PublicReader({
  document,
  reader,
  basePath,
  signedIn,
  children,
}: {
  document: { id: string; title: string; updatedAt: string };
  reader: PublicReaderContext;
  basePath: string;
  signedIn: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const pageHref = (id: string) =>
    `${basePath}${buildContentPublicDocumentPath(id)}`;
  const { signIn, signUp } = publicReaderSignInHrefs(document.id, basePath);
  const untitled = t("sidebar.untitled");

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
          <PublicReaderPath
            ancestors={reader.ancestors}
            current={{
              id: document.id,
              title: document.title,
              icon: reader.icon,
            }}
            pageHref={pageHref}
          />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {signedIn ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.dispatchEvent(new Event("agent-panel:toggle"))
                }
              >
                <IconLayoutSidebarRight />
                {t("publicDocument.chat")}
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <a href={signIn}>{t("publicDocument.signIn")}</a>
                </Button>
                <Button size="sm" asChild>
                  <a href={signUp}>
                    <span className="sm:hidden">
                      {t("publicDocument.signUp")}
                    </span>
                    <span className="hidden sm:inline">
                      {t("publicDocument.tryContentFree")}
                    </span>
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <article className="mx-auto w-full max-w-3xl px-6 pb-16 pt-14 sm:px-8 lg:pb-24">
        {reader.icon ? <ContentIcon value={reader.icon} size={52} /> : null}
        <h1
          className={cn(
            "break-words text-4xl font-semibold tracking-normal text-foreground sm:text-5xl",
            reader.icon && "mt-4",
          )}
        >
          {document.title.trim() || untitled}
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          {t("publicDocument.updated", {
            date: formatUpdatedAt(document.updatedAt),
          })}
        </p>
        <div className="content-public-reader-body mt-8">{children}</div>
        {reader.subPages.length > 0 ? (
          <nav aria-label={t("publicDocument.subPages")} className="mt-10">
            <ul>
              {reader.subPages.map((page) => (
                <li
                  key={page.id}
                  className="content-page-reference content-page-reference--clickable"
                >
                  <a
                    href={pageHref(page.id)}
                    className="content-page-reference__button"
                  >
                    <span
                      className="content-page-reference__icon"
                      aria-hidden="true"
                    >
                      <ContentIcon
                        value={page.icon}
                        size={20}
                        fallback={<IconFileText size={20} stroke={1.8} />}
                      />
                    </span>
                    <span className="content-page-reference__label">
                      {page.title.trim() || untitled}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {signedIn ? null : (
          <aside
            aria-labelledby="public-reader-sign-up"
            className="mt-14 rounded-xl border border-border bg-muted/50 p-6 sm:flex sm:items-center sm:gap-6"
          >
            <div className="min-w-0 flex-1">
              <p id="public-reader-sign-up" className="font-semibold">
                {t("publicDocument.writtenIn")}
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("publicDocument.writtenInDescription")}
              </p>
            </div>
            <div className="mt-4 flex shrink-0 gap-2 sm:mt-0">
              <Button asChild>
                <a href={signUp}>{t("publicDocument.signUpFree")}</a>
              </Button>
              <Button variant="outline" asChild>
                <a href={signIn}>{t("publicDocument.signIn")}</a>
              </Button>
            </div>
          </aside>
        )}
      </article>
    </>
  );
}
