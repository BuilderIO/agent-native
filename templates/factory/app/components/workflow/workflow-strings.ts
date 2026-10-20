import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import {
  lazyGroups,
  type NamespaceKey,
  type Translate,
} from "@/lib/typed-translate";

import type {
  RunStatus,
  RunTriggerKind,
} from "../../../server/workflow/contract.js";

/** Every string the Workflows list and the workflow page show, read from the `workflows.*` catalog keys. */
export function createWorkflowStrings(t: Translate<NamespaceKey<"workflows">>) {
  return lazyGroups({
    tabs: () => ({
      navLabel: t("workflows.tabs.navLabel"),
      workflows: t("workflows.tabs.workflows"),
      items: t("workflows.tabs.items"),
      activity: t("workflows.tabs.activity"),
      settings: t("workflows.tabs.settings"),
    }),
    list: () => ({
      listName: t("workflows.list.listName"),
      newWorkflow: t("workflows.list.newWorkflow"),
      loadFailed: t("workflows.list.loadFailed"),
      retry: t("workflows.list.retry"),
      noWorkflows: t("workflows.list.noWorkflows"),
      openWorkflow: (workflowName: string) =>
        t("workflows.list.openWorkflow", { name: workflowName }),
      turnOn: (workflowName: string) =>
        t("workflows.list.turnOn", { name: workflowName }),
      turnOff: (workflowName: string) =>
        t("workflows.list.turnOff", { name: workflowName }),
      dryRunRequired: t("workflows.list.dryRunRequired"),
      runTest: t("workflows.list.runTest"),
      neverRun: t("workflows.list.neverRun"),
      olderRun: t("workflows.list.olderRun"),
      runsFailed: t("workflows.list.runsFailed"),
      countsFailed: t("workflows.list.countsFailed"),
      paused: t("workflows.list.paused"),
      noSchedule: t("workflows.list.noSchedule"),
      everyHours: (hours: number) =>
        hours === 1
          ? t("workflows.list.everyHour")
          : t("workflows.list.everyHours", { count: hours }),
      nextRun: (when: string) => t("workflows.list.nextRun", { when }),
      waiting: (count: string) => t("workflows.list.waiting", { count }),
      needsYou: (count: string) => t("workflows.list.needsYou", { count }),
      rowActions: (workflowName: string) =>
        t("workflows.list.rowActions", { name: workflowName }),
      delete: t("workflows.list.delete"),
      cancel: t("workflows.list.cancel"),
      deleteTitle: (workflowName: string) =>
        t("workflows.list.deleteTitle", { name: workflowName }),
      deleteBody: t("workflows.list.deleteBody"),
      deleteParked: (count: string) =>
        t("workflows.list.deleteParked", { count }),
      deleteAnyway: t("workflows.list.deleteAnyway"),
      deleteFailed: (reason: string) =>
        t("workflows.list.deleteFailed", { reason }),
    }),
    runStatus: () =>
      ({
        running: t("workflows.runStatus.running"),
        succeeded: t("workflows.runStatus.succeeded"),
        failed: t("workflows.runStatus.failed"),
        paused: t("workflows.runStatus.paused"),
      }) satisfies Record<RunStatus, string>,
    runKind: () =>
      ({
        schedule: t("workflows.runKind.schedule"),
        manual: t("workflows.runKind.manual"),
        dry_run: t("workflows.runKind.dry_run"),
        test: t("workflows.runKind.test"),
      }) satisfies Record<RunTriggerKind, string>,
    newDialog: () => ({
      dialogTitle: t("workflows.newDialog.dialogTitle"),
      promptPlaceholder: t("workflows.newDialog.promptPlaceholder"),
      create: t("workflows.newDialog.create"),
      startFromScratch: t("workflows.newDialog.startFromScratch"),
      untitledName: t("workflows.newDialog.untitledName"),
      createFailed: (reason: string) =>
        t("workflows.newDialog.createFailed", { reason }),
    }),
    page: () => ({
      backToWorkflows: t("workflows.page.backToWorkflows"),
      notFound: t("workflows.page.notFound"),
      loadFailed: t("workflows.page.loadFailed"),
      retry: t("workflows.page.retry"),
      canvasLoading: t("workflows.page.canvasLoading"),
    }),
    toolbar: () => ({
      save: t("workflows.toolbar.save"),
      saving: t("workflows.toolbar.saving"),
      problems: (count: number) => t("workflows.toolbar.problems", { count }),
      problemsListName: t("workflows.toolbar.problemsListName"),
      connectionsNeeded: (count: number) =>
        t("workflows.toolbar.connectionsNeeded", { count }),
      connectionsListName: t("workflows.toolbar.connectionsListName"),
      jumpToProblem: t("workflows.toolbar.jumpToProblem"),
      testRun: t("workflows.toolbar.testRun"),
      testing: t("workflows.toolbar.testing"),
      saveAndTest: t("workflows.toolbar.saveAndTest"),
      moreActions: t("workflows.toolbar.moreActions"),
      runNow: t("workflows.toolbar.runNow"),
      runNowSaveFirst: t("workflows.toolbar.runNowSaveFirst"),
      enabled: t("workflows.toolbar.enabled"),
      turnOn: t("workflows.toolbar.turnOn"),
      turnOff: t("workflows.toolbar.turnOff"),
      saveBeforeEnable: t("workflows.toolbar.saveBeforeEnable"),
      versions: t("workflows.toolbar.versions"),
      askAgent: t("workflows.toolbar.askAgent"),
      askAgentPrefill: t("workflows.toolbar.askAgentPrefill"),
      askAgentContextLabel: t("workflows.toolbar.askAgentContextLabel"),
      unsavedMark: t("workflows.toolbar.unsavedMark"),
    }),
    runPicker: () => ({
      pickerName: t("workflows.runPicker.pickerName"),
      hide: t("workflows.runPicker.hide"),
      noRuns: t("workflows.runPicker.noRuns"),
      listFailed: t("workflows.runPicker.listFailed"),
      version: (version: number) =>
        t("workflows.runPicker.version", { version }),
      olderVersion: (runVersion: number, currentVersion: number) =>
        t("workflows.runPicker.olderVersion", { runVersion, currentVersion }),
      loadFailed: t("workflows.runPicker.loadFailed"),
    }),
    versions: () => ({
      panelTitle: t("workflows.versions.panelTitle"),
      current: t("workflows.versions.current"),
      restore: t("workflows.versions.restore"),
      cancel: t("workflows.versions.cancel"),
      loadFailed: t("workflows.versions.loadFailed"),
      retry: t("workflows.versions.retry"),
      source: {
        agent: t("workflows.versions.source.agent"),
        restore: t("workflows.versions.source.restore"),
        template: t("workflows.versions.source.template"),
      },
      versionLabel: (version: number) =>
        t("workflows.versions.versionLabel", { version }),
      confirmTitle: (version: number) =>
        t("workflows.versions.confirmTitle", { version }),
      confirmBody: t("workflows.versions.confirmBody"),
      confirmDiscards: t("workflows.versions.confirmDiscards"),
      confirmSwitchesOff: t("workflows.versions.confirmSwitchesOff"),
      restored: (version: number) =>
        t("workflows.versions.restored", { version }),
      restoreFailed: t("workflows.versions.restoreFailed"),
      restoreInvalid: (count: number) =>
        t("workflows.versions.restoreInvalid", { count }),
    }),
    save: () => ({
      invalid: (count: number) => t("workflows.save.invalid", { count }),
      switchedOff: t("workflows.save.switchedOff"),
      jobSyncFailed: t("workflows.save.jobSyncFailed"),
      notFound: t("workflows.save.notFound"),
      failed: (reason: string) => t("workflows.save.failed", { reason }),
      serverIssue: (path: string, detail: string) =>
        path ? t("workflows.save.serverIssue", { path, detail }) : detail,
      graphLevel: t("workflows.save.graphLevel"),
    }),
    conflict: () => ({
      dialogTitle: t("workflows.conflict.dialogTitle"),
      body: (version: number | null) =>
        version === null
          ? t("workflows.conflict.bodyNoVersion")
          : t("workflows.conflict.body", { version }),
      loadLatest: t("workflows.conflict.loadLatest"),
      loadLatestNote: t("workflows.conflict.loadLatestNote"),
      keepMine: t("workflows.conflict.keepMine"),
      keepMineNote: t("workflows.conflict.keepMineNote"),
    }),
    leave: () => ({
      dialogTitle: t("workflows.leave.dialogTitle"),
      body: t("workflows.leave.body"),
      stay: t("workflows.leave.stay"),
      discard: t("workflows.leave.discard"),
    }),
    liveRun: () => ({
      dialogTitle: t("workflows.liveRun.dialogTitle"),
      body: t("workflows.liveRun.body"),
      cancel: t("workflows.liveRun.cancel"),
    }),
    run: () => ({
      started: t("workflows.run.started"),
      unavailable: t("workflows.run.unavailable"),
      failed: (reason: string) => t("workflows.run.failed", { reason }),
      liveStarted: t("workflows.run.liveStarted"),
      liveFailed: (reason: string) => t("workflows.run.liveFailed", { reason }),
      enableFailed: (reason: string) =>
        t("workflows.run.enableFailed", { reason }),
    }),
    diagnostics: () => ({
      copy: t("workflows.diagnostics.copy"),
      copied: t("workflows.diagnostics.copied"),
      failed: (reason: string) => t("workflows.diagnostics.failed", { reason }),
    }),
    common: () => ({ close: t("workflows.common.close") }),
    errors: () => ({ unknown: t("workflows.errors.unknown") }),
    nodePanel: () => ({
      panelName: t("workflows.nodePanel.panelName"),
      tabSettings: t("workflows.nodePanel.tabSettings"),
      tabAudit: t("workflows.nodePanel.tabAudit"),
      tabsName: t("workflows.nodePanel.tabsName"),
      testStep: t("workflows.nodePanel.testStep"),
      saveAndTestStep: t("workflows.nodePanel.saveAndTestStep"),
      testStepNeedsRun: t("workflows.nodePanel.testStepNeedsRun"),
      testStepSamplesFailed: t("workflows.nodePanel.testStepSamplesFailed"),
    }),
  });
}

export type WorkflowStrings = ReturnType<typeof createWorkflowStrings>;

export function useWorkflowStrings(): WorkflowStrings {
  const t = useT();
  return useMemo(() => createWorkflowStrings(t), [t]);
}
