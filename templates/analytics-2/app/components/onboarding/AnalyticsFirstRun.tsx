import {
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  registerFirstRunOnboardingExtension,
  type FirstRunOnboardingExtensionProps,
} from "@agent-native/core/client/onboarding";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconChartBar, IconUpload } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { sampleTables } from "@/lib/model/sample-data";

import type createProjectAction from "../../../actions/create-project";
import type importProjectCsvAction from "../../../actions/import-project-csv";
import type uploadProjectFileAction from "../../../actions/upload-project-file";

type CreatedProject = Awaited<ReturnType<typeof createProjectAction.run>>;
type CsvImport = Awaited<ReturnType<typeof importProjectCsvAction.run>>;
type UploadedFile = Awaited<ReturnType<typeof uploadProjectFileAction.run>>;
type Choice =
  | { kind: "sample"; name: string }
  | { kind: "file"; file: File }
  | { kind: "skip" };
type StartedAnalysis = {
  project: CreatedProject;
  uploaded: boolean;
  imported: boolean;
};

const PROJECT_TITLE_MAX = 500;

export function titleFromFileName(fileName: string): { title?: string } {
  const base = fileName.replace(/\.csv$/i, "").trim();
  if (!base) return {};
  const title = [...base].slice(0, PROJECT_TITLE_MAX).join("").trim();
  return title ? { title } : {};
}

/**
 * The first screen a new workspace opens: "Start your first analysis", with the
 * sample datasets the workspace already ships, a way to bring a file, and Skip.
 *
 * The reference opens a setup screen before the dashboard; this app had no
 * first-run registration at all, so a new workspace dropped straight into Home
 * with a checklist. Registering here is what puts the setup screen in front of a
 * first run (the toolkit renders registered extensions on the agent home).
 */
export function AnalyticsFirstRun({
  onComplete,
  onSkip,
}: FirstRunOnboardingExtensionProps) {
  const navigate = useNavigate();
  const t = useT();
  const datasets = sampleTables().slice(0, 3);
  const [pending, setPending] = useState<Choice | null>(null);
  const [failure, setFailure] = useState<{
    choice: Choice;
    message: string;
  } | null>(null);
  const started = useRef(new Map<string, StartedAnalysis>());
  const requestIds = useRef(new Map<string, string>());
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure) {
      alertRef.current?.focus();
    }
  }, [failure]);

  const choiceKey = (choice: Exclude<Choice, { kind: "skip" }>) =>
    choice.kind === "sample"
      ? `sample:${choice.name}`
      : `file:${choice.file.name}:${choice.file.size}:${choice.file.lastModified}`;

  const cleanupAbandoned = (completedKey: string | null) => {
    for (const [key, analysis] of started.current.entries()) {
      if (
        key !== completedKey &&
        (!analysis.imported || key.startsWith("sample:"))
      ) {
        started.current.delete(key);
        requestIds.current.delete(key);
        void callAction("delete-project", {
          projectId: analysis.project.id,
        }).catch(() => {});
      }
    }
  };

  const prepareAnalysis = async (choice: Exclude<Choice, { kind: "skip" }>) => {
    if (choice.kind === "file") {
      if (!choice.file.name.toLowerCase().endsWith(".csv")) {
        throw new Error(t("notebook.projectFiles.csvRequired"));
      }
      if (!choice.file.size || choice.file.size > 2 * 1024 * 1024) {
        throw new Error(t("notebook.projectFiles.csvSize"));
      }
    }
    const key = choiceKey(choice);
    let analysis = started.current.get(key);
    if (!analysis) {
      let requestId = requestIds.current.get(key);
      if (!requestId) {
        requestId = crypto.randomUUID();
        requestIds.current.set(key, requestId);
      }
      const project = await callAction<CreatedProject>(
        "create-project",
        choice.kind === "sample"
          ? { title: choice.name, sampleDataset: choice.name, requestId }
          : {
              ...titleFromFileName(choice.file.name),
              requestId,
            },
      );
      analysis = {
        project,
        uploaded: false,
        imported: choice.kind === "sample",
      };
      started.current.set(key, analysis);
    }
    if (choice.kind === "file" && !analysis.imported) {
      const bytes = new Uint8Array(await choice.file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const dataBase64 = btoa(binary);
      if (!analysis.uploaded) {
        await callAction<UploadedFile>("upload-project-file", {
          projectId: analysis.project.id,
          filename: choice.file.name,
          mimeType: choice.file.type || "text/csv",
          dataBase64,
        });
        analysis.uploaded = true;
      }
      await callAction<CsvImport>("import-project-csv", {
        projectId: analysis.project.id,
        filename: choice.file.name,
        dataBase64,
      });
      analysis.imported = true;
    }
    return analysis.project;
  };

  const start = async (choice: Choice) => {
    if (busy.current) return;
    busy.current = true;
    setPending(choice);
    setFailure(null);
    try {
      const project =
        choice.kind === "skip" ? null : await prepareAnalysis(choice);
      if ((await onComplete()) === false) {
        setFailure({
          choice,
          message: t("analytics.onboarding.completeFailed"),
        });
        return;
      }
      cleanupAbandoned(choice.kind === "skip" ? null : choiceKey(choice));
      if (project === null) onSkip();
      else await navigate(project.href);
    } catch (cause) {
      setFailure({
        choice,
        message:
          actionErrorMessage(cause) ??
          (cause instanceof Error ? cause.message : t("error.genericDetails")),
      });
    } finally {
      busy.current = false;
      setPending(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">
          {t("analytics.onboarding.firstRunTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("analytics.onboarding.firstRunDescription")}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">
          {t("analytics.onboarding.sampleDatasets")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-3">
          {datasets.map((table) => (
            <li key={table.name}>
              <Button
                className="h-full w-full justify-start"
                disabled={pending !== null}
                aria-busy={
                  pending?.kind === "sample" && pending.name === table.name
                }
                onClick={() => void start({ kind: "sample", name: table.name })}
                variant="outline"
              >
                <IconChartBar aria-hidden="true" size={16} stroke={1.8} />
                <span className="truncate">{table.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          tabIndex={-1}
          aria-label={t("analytics.onboarding.uploadFile")}
          className="sr-only"
          disabled={pending !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void start({ kind: "file", file });
          }}
        />
        <Button
          variant="outline"
          disabled={pending !== null}
          aria-busy={pending?.kind === "file"}
          onClick={() => fileInput.current?.click()}
        >
          <IconUpload aria-hidden="true" size={16} stroke={1.8} />
          {t("analytics.onboarding.uploadFile")}
        </Button>
      </section>

      {failure && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="space-y-2 text-sm text-destructive focus:outline-none"
        >
          <p>{failure.message}</p>
          <Button
            variant="outline"
            disabled={pending !== null}
            onClick={() => void start(failure.choice)}
          >
            {t("analytics.onboarding.retry")}
          </Button>
        </div>
      )}

      <footer>
        <Button
          disabled={pending !== null}
          aria-busy={pending?.kind === "skip"}
          onClick={() => void start({ kind: "skip" })}
          variant="ghost"
        >
          {t("analytics.onboarding.skipShort")}
        </Button>
      </footer>
    </div>
  );
}

registerFirstRunOnboardingExtension({
  id: "analytics-first-run",
  component: AnalyticsFirstRun,
  placement: "before-setup",
  stepCount: 1,
  optional: true,
});
