import { agentNativePath, useSession, useT } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconBrush,
  IconDeviceDesktop,
  IconDeviceFloppy,
  IconLayoutGrid,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

function buildSignInHref(): string {
  const ret = "/?intent=save";
  return `${agentNativePath("/_agent-native/sign-in")}?return=${encodeURIComponent(ret)}`;
}

export default function VisualEditPage() {
  const t = useT();
  const { session } = useSession();
  const hasSession = Boolean(session?.email);
  const primaryHref = hasSession ? "/" : buildSignInHref();

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col px-5 py-5 sm:px-8 lg:px-10">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4">
          <Link
            to="/"
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            {t("navigation.brand")}
          </Link>
          <Button asChild variant="outline" size="sm">
            <a href={primaryHref}>
              {hasSession
                ? t("visualEdit.openDesign")
                : t("visualEdit.saveCta")}
              <IconArrowUpRight className="size-4" />
            </a>
          </Button>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:py-14">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <IconBrush className="size-3.5" />
              {t("visualEdit.eyebrow")}
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">
              {t("visualEdit.title")}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
              {t("visualEdit.description")}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <a href={primaryHref}>
                  <IconDeviceFloppy className="size-4" />
                  {hasSession
                    ? t("visualEdit.openDesign")
                    : t("visualEdit.saveCta")}
                </a>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <Link to="/templates">{t("visualEdit.templatesCta")}</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="rounded-md border border-border bg-background">
              <div className="flex h-10 items-center gap-2 border-b border-border px-3">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <div className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconDeviceDesktop className="size-3.5" />
                  {t("visualEdit.previewLabel")}
                </div>
              </div>
              <div className="grid gap-3 p-4">
                <div className="h-28 rounded-md border border-dashed border-border bg-muted/40" />
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-20 rounded-md border border-border bg-background" />
                  <div className="h-20 rounded-md border border-border bg-background" />
                  <div className="h-20 rounded-md border border-border bg-background" />
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <IconLayoutGrid className="size-3.5" />
                  {t("visualEdit.layoutLabel")}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
