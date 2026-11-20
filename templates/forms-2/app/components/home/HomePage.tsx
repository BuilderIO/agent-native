import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFolderPlus, IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { FormRowsSkeleton } from "@/components/home/FormRow";
import { TemplateRow } from "@/components/home/TemplateRow";
import { WorkspaceSection } from "@/components/home/WorkspaceSection";
import { NewWorkspaceDialog } from "@/components/shell/NewWorkspaceDialog";
import { PageColumn } from "@/components/shell/PageColumn";
import { TopBar } from "@/components/shell/TopBar";
import { useNewForm } from "@/components/shell/useNewForm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const HOME_ROWS_PER_WORKSPACE = 10;

export function HomePage() {
  const t = useT();
  const workspaces = useActionQuery("list-workspaces", {
    formLimit: HOME_ROWS_PER_WORKSPACE,
  });
  const { createForm, isPending, isError } = useNewForm();
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const list = workspaces.data?.workspaces ?? [];
  const hasForms = list.some((workspace) => workspace.formCount > 0);

  return (
    <>
      <TopBar crumbs={[]}>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-7 gap-[8.4px] overflow-hidden rounded-[7px] px-[9.8px] text-sm leading-[14px] font-normal text-foreground"
          onClick={() => setNewWorkspaceOpen(true)}
        >
          <i className="-ml-[2.8px] flex gap-[8.4px] text-muted-foreground">
            <IconFolderPlus className="size-[17px]" />
          </i>
          <span className="flex gap-[8.4px] font-semibold text-muted-foreground">
            {t("forms.home.newWorkspace")}
          </span>
        </Button>
        <Button
          size="sm"
          className="relative h-7 gap-[8.4px] overflow-hidden rounded-[7px] px-[9.8px] text-sm leading-[14px] font-normal text-foreground"
          disabled={isPending || list.length === 0}
          onClick={() => createForm(list[0]?.id)}
        >
          <i className="-ml-[2.8px] flex gap-[8.4px] text-primary-foreground">
            <IconPlus className="size-[17px]" />
          </i>
          <span className="flex gap-[8.4px] font-semibold text-primary-foreground">
            {t("forms.common.newForm")}
          </span>
        </Button>
      </TopBar>
      <PageColumn className="pt-[47px] pb-16">
        {isError ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {t("forms.common.createFormFailed")}
          </p>
        ) : null}
        {workspaces.isPending ? (
          <div className="flex flex-col gap-[11px]">
            <Skeleton className="h-[30px] w-40" />
            <FormRowsSkeleton />
          </div>
        ) : workspaces.isError ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {t("forms.home.loadFailed")}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void workspaces.refetch()}
            >
              {t("forms.common.retry")}
            </Button>
          </div>
        ) : (
          <>
            {hasForms ? null : (
              <p className="mb-6 text-sm text-muted-foreground">
                {t("forms.home.empty")}
              </p>
            )}
            {list.map((workspace) => (
              <WorkspaceSection
                key={workspace.id}
                id={workspace.id}
                name={workspace.name}
                formCount={workspace.formCount}
                folders={workspace.folders}
                forms={workspace.forms}
                seeAll={workspace.formCount > HOME_ROWS_PER_WORKSPACE}
                onNewForm={() => createForm(workspace.id)}
              />
            ))}
            {/* The templates are a different offer from the account's own forms, so
                a rule separates them instead of running them into the last workspace. */}
            <div
              data-home-separator
              role="separator"
              aria-orientation="horizontal"
              className="mt-2 mb-8 border-t border-border"
            />
            <TemplateRow
              disabled={isPending || list.length === 0}
              onPick={(templateId) => createForm(list[0]?.id, templateId)}
            />
          </>
        )}
      </PageColumn>
      <NewWorkspaceDialog
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
      />
    </>
  );
}
