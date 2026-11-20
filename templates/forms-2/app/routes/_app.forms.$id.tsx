import { useT } from "@agent-native/core/client/i18n";
import { IconEdit, IconLink, IconUser } from "@tabler/icons-react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";

import { copyFormLink, FormMenu } from "@/components/form-menu/FormMenu";
import { isNotFound, useFormDetail } from "@/components/forms/form-data";
import { ErrorPanel, NotFoundPanel } from "@/components/forms/NotFoundPanel";
import { formDisplayName } from "@/components/shell/format";
import { PageColumn } from "@/components/shell/PageColumn";
import { paths } from "@/components/shell/paths";
import { TopBar } from "@/components/shell/TopBar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: "Form - Forms" }]; // i18n-ignore meta() has no hooks; the document title is not user-visible chrome here
}

const TABS = [
  { labelKey: "forms.routes.tabInsights", to: "", end: true },
  { labelKey: "forms.routes.tabSubmissions", to: "/submissions", end: false },
  { labelKey: "forms.routes.tabShare", to: "/share", end: false },
  { labelKey: "forms.common.settings", to: "/settings", end: false },
] as const;

function HeaderSkeleton() {
  return (
    <PageColumn className="pt-12">
      <Skeleton className="h-8 w-72" />
      <div className="mt-6 flex gap-4">
        {TABS.map((tab) => (
          <Skeleton key={tab.labelKey} className="h-5 w-16" />
        ))}
      </div>
    </PageColumn>
  );
}

export default function FormLayoutRoute() {
  const t = useT();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: form, error, isLoading, refetch } = useFormDetail(id);

  if (isNotFound(error))
    return (
      <>
        <TopBar crumbs={[]} />
        <NotFoundPanel what="form" />
      </>
    );
  if (error)
    return (
      <>
        <TopBar crumbs={[]} />
        <PageColumn className="pt-12">
          <ErrorPanel onRetry={() => void refetch()} />
        </PageColumn>
      </>
    );
  if (isLoading || !form)
    return (
      <>
        <TopBar crumbs={[]} />
        <HeaderSkeleton />
      </>
    );

  const name = formDisplayName(form, t);

  return (
    <>
      <div className="relative z-10 -mb-12">
        <TopBar
          crumbs={[
            {
              label: form.workspaceName,
              to: paths.workspace(form.workspaceId),
            },
            { label: name },
          ]}
        >
          <span
            role="img"
            aria-label={t("forms.routes.avatar")}
            className="flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <IconUser className="size-3.5" />
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copyFormLink(form.id, t)}
          >
            <IconLink /> {t("forms.routes.copyShareLink")}
          </Button>
          <Button size="sm" asChild>
            <NavLink to={paths.edit(form.id)}>
              <IconEdit /> {t("forms.routes.edit")}
            </NavLink>
          </Button>
        </TopBar>
      </div>
      <PageColumn className="pt-24">
        <div className="flex pb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-[28px] font-extrabold leading-8">{name}</h1>
            <div>
              <FormMenu
                form={form}
                triggerClassName="size-8 rounded-[6px] px-0"
                onDeleted={() => void navigate("/")}
              />
            </div>
          </div>
        </div>
        <div
          role="navigation"
          aria-label={t("forms.routes.formSections")}
          className="overflow-x-auto overflow-y-hidden border-b border-b-border"
        >
          <div className="flex">
            <div className="flex">
              {TABS.map((tab) => (
                <NavLink
                  key={tab.labelKey}
                  to={`${paths.form(form.id)}${tab.to}`}
                  end={tab.end}
                  className="mr-3 text-base leading-[18.4px] font-normal text-[color:var(--forms-link)]"
                >
                  {({ isActive }) => (
                    <div
                      className={cn(
                        "-mb-px flex items-center border-b-2 px-0 py-3 text-sm leading-[14px] font-semibold",
                        isActive
                          ? "border-b-foreground text-foreground"
                          : "border-b-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(tab.labelKey)}
                    </div>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </PageColumn>
      <Outlet context={{ form }} />
    </>
  );
}
