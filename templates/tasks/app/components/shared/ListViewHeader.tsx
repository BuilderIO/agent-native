import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";

import { PageHeader } from "@/components/shared/PageHeader";
import { ListSelectionHeaderToggle } from "@/components/shared/selection/ListSelectionHeaderToggle";
import { type ListSelection } from "@/components/shared/selection/use-list-selection";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface ListViewHeaderProps<T extends { id: string }> {
  title: string;
  description: string;
  isPending: boolean;
  showSelectToggle: boolean;
  selection: ListSelection<T> | null;
  toolbarBusy?: boolean;
  includeDone?: boolean;
  onIncludeDoneChange?: (next: boolean) => void;
  showAgentToggle?: boolean;
}

export function ListViewHeader<T extends { id: string }>({
  title,
  description,
  isPending,
  showSelectToggle,
  selection,
  toolbarBusy,
  includeDone,
  onIncludeDoneChange,
  showAgentToggle = false,
}: ListViewHeaderProps<T>) {
  const t = useT();
  const showIncludeDone =
    includeDone !== undefined && onIncludeDoneChange !== undefined;
  const hasActions =
    (showSelectToggle && selection) || showIncludeDone || showAgentToggle;

  return (
    <PageHeader
      title={title}
      description={description}
      actions={
        hasActions ? (
          <>
            {showSelectToggle && selection ? (
              <ListSelectionHeaderToggle
                selectionMode={selection.state.selectionMode}
                disabled={toolbarBusy || isPending}
                onSelectionModeChange={
                  selection.actions.setSelectionModeFromHeader
                }
              />
            ) : null}
            {showIncludeDone ? (
              <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2">
                <Switch
                  id="include-done"
                  checked={includeDone}
                  onCheckedChange={onIncludeDoneChange}
                  disabled={isPending}
                />
                <Label
                  htmlFor="include-done"
                  className="text-sm whitespace-nowrap"
                >
                  {t("common.showAll")}
                </Label>
              </div>
            ) : null}
            {showAgentToggle ? <AgentToggleButton /> : null}
          </>
        ) : undefined
      }
    />
  );
}
