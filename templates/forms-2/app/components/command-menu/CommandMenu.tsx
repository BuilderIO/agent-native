import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { CommandMenu as ToolkitCommandMenu } from "@agent-native/toolkit/app/shared";
import { IconArrowRight, IconFolderPlus, IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { formDisplayName, formSearchQuery } from "@/components/shell/format";
import { NewWorkspaceDialog } from "@/components/shell/NewWorkspaceDialog";
import { formHref, paths } from "@/components/shell/paths";
import { useNewForm } from "@/components/shell/useNewForm";
import { sonnerToast } from "@/components/ui/sonner";

import { consumeEarlyShortcut } from "./early-shortcut";
import { searchPlaces } from "./search-places";

const SEARCH_DEBOUNCE_MS = 300;

function FormResults({ query }: { query: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const forms = useActionQuery(
    "list-forms",
    { query: settled, limit: 20 },
    { enabled: settled !== "" },
  );
  const results = settled === query ? (forms.data?.forms ?? []) : [];
  if (results.length === 0) return null;
  return (
    <ToolkitCommandMenu.Group heading={t("forms.command.forms")}>
      {results.map((form) => (
        <ToolkitCommandMenu.Item
          key={form.id}
          value={`form-${form.id}`}
          onSelect={() => void navigate(formHref(form))}
        >
          {formDisplayName(form, t)}
        </ToolkitCommandMenu.Item>
      ))}
    </ToolkitCommandMenu.Group>
  );
}

/** Workspaces and folders the search knows about, next to the forms it already finds. */
function PlaceResults({ query }: { query: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const workspaces = useActionQuery(
    "list-workspaces",
    { formLimit: 0 },
    { enabled: settled !== "" },
  );
  const hits =
    settled === query
      ? searchPlaces(workspaces.data?.workspaces ?? [], settled)
      : [];
  if (hits.length === 0) return null;
  const spaces = hits.filter((hit) => hit.kind === "workspace");
  const folders = hits.filter((hit) => hit.kind === "folder");
  return (
    <>
      {spaces.length ? (
        <ToolkitCommandMenu.Group heading={t("forms.command.workspaces")}>
          {spaces.map((hit) => (
            <ToolkitCommandMenu.Item
              key={`workspace-${hit.id}`}
              value={`workspace-${hit.id}`}
              onSelect={() => void navigate(paths.workspace(hit.workspaceId))}
            >
              {hit.name}
            </ToolkitCommandMenu.Item>
          ))}
        </ToolkitCommandMenu.Group>
      ) : null}
      {folders.length ? (
        <ToolkitCommandMenu.Group heading={t("forms.command.folders")}>
          {folders.map((hit) => (
            <ToolkitCommandMenu.Item
              key={`folder-${hit.id}`}
              value={`folder-${hit.id}`}
              onSelect={() =>
                void navigate(paths.folder(hit.workspaceId, hit.folderId))
              }
            >
              {hit.name}
            </ToolkitCommandMenu.Item>
          ))}
        </ToolkitCommandMenu.Group>
      ) : null}
    </>
  );
}

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { createForm, isError: createFormFailed } = useNewForm();
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  useEffect(() => {
    if (consumeEarlyShortcut()) onOpenChange(true);
  }, [onOpenChange]);
  useEffect(() => {
    if (createFormFailed) sonnerToast.error(t("forms.common.createFormFailed"));
  }, [createFormFailed, t]);
  const go = (path: string) => () => void navigate(path);
  return (
    <>
      <ToolkitCommandMenu
        open={open}
        onOpenChange={onOpenChange}
        placeholder={t("forms.command.searchPlaceholder")}
        inputLabel={t("forms.command.searchPlaceholder")}
        showAgentFallback={false}
        showAbout={false}
        showSettingsCommand={false}
        showSignOutCommand={false}
        renderResults={(search) => {
          const query = formSearchQuery(search);
          if (!query) return null;
          return (
            <>
              <PlaceResults query={query} />
              <FormResults query={query} />
            </>
          );
        }}
        renderResultsHasItems={() => false}
      >
        <ToolkitCommandMenu.Group heading={t("forms.command.actions")}>
          <ToolkitCommandMenu.Item onSelect={() => createForm()}>
            <IconPlus aria-hidden className="size-4" />
            {t("forms.common.newForm")}
          </ToolkitCommandMenu.Item>
          <ToolkitCommandMenu.Item onSelect={() => setNewWorkspaceOpen(true)}>
            <IconFolderPlus aria-hidden className="size-4" />
            {t("forms.shell.newWorkspace")}
          </ToolkitCommandMenu.Item>
        </ToolkitCommandMenu.Group>
        <ToolkitCommandMenu.Group heading={t("forms.command.navigation")}>
          <ToolkitCommandMenu.Item onSelect={go(paths.home)}>
            <IconArrowRight aria-hidden className="size-4" />
            {t("forms.command.goHome")}
          </ToolkitCommandMenu.Item>
          <ToolkitCommandMenu.Item onSelect={go("/settings/members")}>
            <IconArrowRight aria-hidden className="size-4" />
            {t("forms.common.members")}
          </ToolkitCommandMenu.Item>
          <ToolkitCommandMenu.Item onSelect={go("/settings")}>
            <IconArrowRight aria-hidden className="size-4" />
            {t("forms.command.goSettings")}
          </ToolkitCommandMenu.Item>
        </ToolkitCommandMenu.Group>
      </ToolkitCommandMenu>
      <NewWorkspaceDialog
        open={newWorkspaceOpen}
        onOpenChange={setNewWorkspaceOpen}
      />
    </>
  );
}
