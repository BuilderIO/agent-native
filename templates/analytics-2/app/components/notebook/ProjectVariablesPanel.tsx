import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IconVariable, IconX } from "@tabler/icons-react";

import type { KernelVariable } from "./useNotebookRun";
import { formatResultDimensions } from "./utils";

/**
 * One result variable the notebook produced. A run cell names its result
 * variable (`resultVariable`); the value is the table it last wrote.
 */
export type NotebookVariable = {
  cellId: string;
  name: string;
  cellLabel: string;
  kind: string;
  rows: number;
  columns: number;
};

export function ProjectVariablesPanel({
  variables,
  liveVariables,
  onOpenEnvironment,
  onClose,
  onJump,
}: {
  variables: readonly NotebookVariable[];
  liveVariables?: readonly KernelVariable[] | undefined;
  onOpenEnvironment?: (() => void) | undefined;
  onClose: () => void;
  onJump: (cellId: string) => void;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const title = t("notebook.pythonVariables");
  return (
    <aside className="nb-side-panel" aria-label={title}>
      <header className="nb-side-panel-header">
        <h2 className="nb-side-panel-title">{title}</h2>
        <button
          type="button"
          className="nb-side-panel-close"
          aria-label={t("notebook.pythonCloseVariables")}
          onClick={onClose}
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </header>
      {liveVariables ? (
        <>
          <h3 className="nb-side-panel-subtitle">
            {t("notebook.pythonSecrets")}
          </h3>
          <p className="nb-side-panel-note">{t("notebook.pythonNoSecrets")}</p>
          <h3 className="nb-side-panel-subtitle">
            {t("notebook.pythonEnvironmentVariables")}
          </h3>
          {onOpenEnvironment && (
            <button
              type="button"
              className="nb-text-button"
              onClick={onOpenEnvironment}
            >
              {t("notebook.pythonEnvironmentSettings")}
            </button>
          )}
          <h3 className="nb-side-panel-subtitle">
            {t("notebook.pythonVariableExplorer")}
          </h3>
          <p className="nb-side-panel-note">
            {t("notebook.pythonVariableScope")}
          </p>
          <div className="nb-kernel-variables">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("notebook.pythonVariableName")}</th>
                  <th scope="col">{t("notebook.pythonVariableType")}</th>
                  <th scope="col">{t("notebook.pythonVariableValue")}</th>
                </tr>
              </thead>
              <tbody>
                {liveVariables
                  .filter((variable) => variable.kind !== "module")
                  .map((variable) => (
                    <tr key={variable.name}>
                      <td>
                        {variable.producerCellId ? (
                          <button
                            type="button"
                            className="nb-text-button"
                            onClick={() => {
                              const cellId = variable.producerCellId;
                              if (cellId) onJump(cellId);
                            }}
                          >
                            {variable.name}
                          </button>
                        ) : (
                          variable.name
                        )}
                      </td>
                      <td>{variable.type}</td>
                      <td>{variable.preview}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : variables.length === 0 ? (
        <p className="nb-side-panel-note">{t("notebook.pythonNoVariables")}</p>
      ) : (
        <ul className="nb-outline-list">
          {variables.map((variable) => (
            <li key={variable.cellId}>
              <button
                type="button"
                className="nb-outline-item"
                onClick={() => onJump(variable.cellId)}
              >
                <IconVariable size={12} aria-hidden="true" />
                <span className="nb-outline-name">{variable.name}</span>
                <span className="nb-outline-kind">
                  {formatResultDimensions(
                    t,
                    t("queryPaging.rows", {
                      count: variable.rows,
                      formattedCount: formatNumber(variable.rows),
                    }),
                    variable.columns,
                  )}
                </span>
              </button>
              <span className="nb-outline-kind">{variable.cellLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
