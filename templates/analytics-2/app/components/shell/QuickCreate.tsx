import { useT } from "@agent-native/core/client/i18n";
import {
  IconBox,
  IconChartDots,
  IconFileImport,
  IconFolderPlus,
  IconFolders,
  IconLayoutDashboard,
  IconMessageCircle,
  IconPlus,
  IconUpload,
} from "@tabler/icons-react";

import { Popover } from "./Popover";
import { MenuButton, MenuDivider } from "./primitives";
import type {
  WorkspaceShellFeatures,
  WorkspaceShellHandler,
  WorkspaceShellQuickCreate,
} from "./types";

export function QuickCreate({
  features,
  quickCreate,
  onCreateProject,
  onCreateThread,
}: {
  features: WorkspaceShellFeatures;
  quickCreate?: WorkspaceShellQuickCreate | undefined;
  onCreateProject: WorkspaceShellHandler;
  onCreateThread: WorkspaceShellHandler;
}) {
  const t = useT();
  const hasImport =
    quickCreate?.onImportProject !== undefined ||
    quickCreate?.onImportComponent !== undefined;

  const projectButton = (
    <button
      type="button"
      className="ws-quick-button"
      disabled={!features.canCreateProject}
      onClick={() => {
        void onCreateProject();
      }}
    >
      <IconLayoutDashboard size={16} aria-hidden="true" />
      Project
    </button>
  );
  const threadButton = (
    <button
      type="button"
      className="ws-quick-button"
      disabled={!features.canCreateThread}
      onClick={() => {
        void onCreateThread();
      }}
    >
      <IconMessageCircle size={16} aria-hidden="true" />
      Thread
    </button>
  );

  return (
    <div className="ws-quick-create">
      {features.canCreateProject ? (
        projectButton
      ) : (
        <span
          className="ws-quick-button-wrap"
          role="group"
          tabIndex={0}
          title={t("analytics.shell.createProjectDenied")}
          aria-label={t("analytics.shell.createProjectDenied")}
        >
          {projectButton}
        </span>
      )}
      {features.canCreateThread ? (
        threadButton
      ) : (
        <span
          className="ws-quick-button-wrap"
          role="group"
          tabIndex={0}
          title={t("analytics.shell.createThreadDenied")}
          aria-label={t("analytics.shell.createThreadDenied")}
        >
          {threadButton}
        </span>
      )}
      <Popover
        label="Create new"
        role="menu"
        minWidth={180}
        trigger={(triggerProps) => (
          <button
            type="button"
            className="ws-quick-button ws-quick-plus"
            aria-label="Create new"
            title="Create new"
            {...triggerProps}
          >
            <IconPlus size={16} aria-hidden="true" />
          </button>
        )}
      >
        {(close) => {
          const run = (handler: WorkspaceShellHandler | undefined) => {
            close();
            void handler?.();
          };
          return (
            <div className="ws-menu">
              <MenuButton
                icon={<IconLayoutDashboard size={16} />}
                label="New project"
                disabled={!features.canCreateProject}
                onSelect={() => run(onCreateProject)}
              />
              <MenuButton
                icon={<IconMessageCircle size={16} />}
                label="New thread"
                disabled={!features.canCreateThread}
                onSelect={() => run(onCreateThread)}
              />
              {quickCreate?.onCreateComponent ? (
                <MenuButton
                  icon={<IconBox size={16} />}
                  label="New component"
                  onSelect={() => run(quickCreate.onCreateComponent)}
                />
              ) : null}
              {quickCreate?.onCreateExploration ? (
                <MenuButton
                  icon={<IconChartDots size={16} />}
                  label="New exploration"
                  onSelect={() => run(quickCreate.onCreateExploration)}
                />
              ) : null}
              {quickCreate?.onCreateCollection ? (
                <MenuButton
                  icon={<IconFolders size={16} />}
                  label={t("analytics.shell.createCollectionAction")}
                  onSelect={() => run(quickCreate.onCreateCollection)}
                />
              ) : null}
              {quickCreate?.onCreateFolder ? (
                <MenuButton
                  icon={<IconFolderPlus size={16} />}
                  label="New folder"
                  onSelect={() => run(quickCreate.onCreateFolder)}
                />
              ) : null}
              {hasImport ? <MenuDivider /> : null}
              {quickCreate?.onImportProject ? (
                <MenuButton
                  icon={<IconUpload size={16} />}
                  label="Upload project"
                  onSelect={() => run(quickCreate.onImportProject)}
                />
              ) : null}
              {quickCreate?.onImportComponent ? (
                <MenuButton
                  icon={<IconFileImport size={16} />}
                  label="Upload component"
                  onSelect={() => run(quickCreate.onImportComponent)}
                />
              ) : null}
            </div>
          );
        }}
      </Popover>
    </div>
  );
}
