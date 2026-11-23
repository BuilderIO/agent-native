import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Cell, CellOutput } from "@/lib/model/contracts";
import { compareOrder } from "@/lib/model/order";
import type { ProjectVersion } from "@/lib/model/project-version-contracts";

import { CellOutputView } from "./CellOutputView";
import { cellTitleAtPosition, describeCell } from "./utils";
import { projectVersionLabel, versionWhen } from "./version-age";

function config(cell: Cell) {
  const values = Object.entries(cell.contents).filter(
    ([key]) =>
      !["id", "source", "markdown", "text", "pendingEdit"].includes(key),
  );
  return JSON.stringify(Object.fromEntries(values), null, 2);
}

function ComparedCell({
  cell,
  output,
  showConfig,
}: {
  cell: Cell | undefined;
  output: CellOutput | undefined;
  showConfig: boolean;
}) {
  const t = useT();
  if (!cell)
    return (
      <p className="text-muted-foreground">
        {t("notebook.history.missingCell")}
      </p>
    );
  return (
    <div className="min-w-0 space-y-2">
      <pre className="overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">
        {showConfig ? config(cell) : describeCell(t, cell.contents)}
      </pre>
      {showConfig ? null : <CellOutputView output={output} />}
    </div>
  );
}

export function ProjectVersionCompareDialog({
  projectId,
  version,
  onClose,
}: {
  projectId: string;
  version: ProjectVersion;
  onClose: () => void;
}) {
  const t = useT();
  const [showConfig, setShowConfig] = useState(false);
  const draft = useActionQuery(
    "get-project",
    { projectId },
    { refetchOnMount: "always" },
  );
  const saved = useActionQuery("get-project", {
    projectId,
    version: version.id,
  });
  const oldCells = [...(saved.data?.project.cells ?? [])].sort((a, b) =>
    compareOrder(a.contents.order, b.contents.order),
  );
  const newCells = [...(draft.data?.project.cells ?? [])].sort((a, b) =>
    compareOrder(a.contents.order, b.contents.order),
  );
  const before = new Map(
    oldCells.map((cell, index) => [cell.id, { cell, index }]),
  );
  const after = new Map(
    newCells.map((cell, index) => [cell.id, { cell, index }]),
  );
  const ids = new Set([...after.keys(), ...before.keys()]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[85vh] overflow-auto sm:max-w-4xl"
      >
        <DialogHeader>
          <DialogTitle>{t("notebook.history.compareTitle")}</DialogTitle>
        </DialogHeader>
        <Tabs
          value={showConfig ? "config" : "display"}
          onValueChange={(value) => setShowConfig(value === "config")}
        >
          <TabsList>
            <TabsTrigger value="display">
              {t("notebook.history.display")}
            </TabsTrigger>
            <TabsTrigger value="config">
              {t("notebook.history.config")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {draft.isError || saved.isError ? (
          <p role="alert">{t("notebook.versionPreviewFailed")}</p>
        ) : !draft.data || !saved.data ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm font-medium">
              <span>
                <span className="font-normal">
                  {versionWhen(version.createdAt, t, (value) =>
                    new Date(value).toLocaleString(),
                  )}
                </span>{" "}
                {projectVersionLabel(version, t)}
              </span>
              <span>{t("notebook.history.draft")}</span>
            </div>
            <ol className="grid gap-3">
              {[...ids].map((id) => {
                const old = before.get(id);
                const next = after.get(id);
                const heading = next ?? old;
                if (!heading) return null;
                const oldOutput = saved.data?.outputs[id]?.output;
                const nextOutput = draft.data?.outputs[id]?.output;
                const skipped =
                  old &&
                  next &&
                  config(old.cell) === config(next.cell) &&
                  describeCell(t, old.cell.contents) ===
                    describeCell(t, next.cell.contents) &&
                  JSON.stringify(oldOutput) === JSON.stringify(nextOutput);

                return (
                  <li key={id} className="grid gap-2 border-t pt-2">
                    <h3 className="text-sm font-medium">
                      {cellTitleAtPosition(
                        heading.cell.contents,
                        heading.index + 1,
                      )}
                    </h3>
                    {skipped ? (
                      <span className="text-muted-foreground">
                        {t("notebook.history.skipped")}
                      </span>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <ComparedCell
                          cell={old?.cell}
                          output={oldOutput ?? undefined}
                          showConfig={showConfig}
                        />
                        <ComparedCell
                          cell={next?.cell}
                          output={nextOutput ?? undefined}
                          showConfig={showConfig}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
