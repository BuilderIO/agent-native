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
      pageTitle: t("workflows.list.pageTitle"),
      pageSubtitle: t("workflows.list.pageSubtitle"),
      searchPlaceholder: t("workflows.list.searchPlaceholder"),
      clearSearch: t("workflows.list.clearSearch"),
      noMatches: t("workflows.list.noMatches"),
      sortLabel: t("workflows.list.sortLabel"),
      sortAttention: t("workflows.list.sortAttention"),
      sortUpdated: t("workflows.list.sortUpdated"),
      sortName: t("workflows.list.sortName"),
      statusLabel: t("workflows.list.statusLabel"),
      statusAll: t("workflows.list.statusAll"),
      statusOn: t("workflows.list.statusOn"),
      statusOff: t("workflows.list.statusOff"),
      updated: (when: string) => t("workflows.list.updated", { when }),
      open: t("workflows.list.open"),
      rename: t("workflows.list.rename"),
      renameTitle: t("workflows.list.renameTitle"),
      renameLabel: t("workflows.list.renameLabel"),
      renameFailed: (reason: string) =>
        t("workflows.list.renameFailed", { reason }),
      renamedJobFailed: t("workflows.list.renamedJobFailed"),
      duplicate: t("workflows.list.duplicate"),
      duplicated: (name: string) => t("workflows.list.duplicated", { name }),
      duplicateFailed: (reason: string) =>
        t("workflows.list.duplicateFailed", { reason }),
      copyName: (name: string) => t("workflows.list.copyName", { name }),
      loadMore: t("workflows.list.loadMore"),
    }),
    stats: () => ({
      on: t("workflows.stats.on"),
      onOfTotal: (on: string, total: string) =>
        t("workflows.stats.onOfTotal", { on, total }),
      needsYou: t("workflows.stats.needsYou"),
      waiting: t("workflows.stats.waiting"),
      failing: t("workflows.stats.failing"),
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
      tabsName: t("workflows.nodePanel.tabsName"),
      testStep: t("workflows.nodePanel.testStep"),
      saveAndTestStep: t("workflows.nodePanel.saveAndTestStep"),
      testStepNeedsRun: t("workflows.nodePanel.testStepNeedsRun"),
      testStepSamplesFailed: t("workflows.nodePanel.testStepSamplesFailed"),
    }),
    nodeDetails: () => ({
      dialogName: t("workflows.nodeDetails.dialogName"),
      tabParameters: t("workflows.nodeDetails.tabParameters"),
      tabHistory: t("workflows.nodeDetails.tabHistory"),
      close: t("workflows.nodeDetails.close"),
      askAgentPrefill: t("workflows.nodeDetails.askAgentPrefill"),
      inputTitle: t("workflows.nodeDetails.inputTitle"),
      outputTitle: t("workflows.nodeDetails.outputTitle"),
    }),
    nodeData: () => ({
      viewLabel: t("workflows.nodeData.viewLabel"),
      view: {
        schema: t("workflows.nodeData.view.schema"),
        table: t("workflows.nodeData.view.table"),
        json: t("workflows.nodeData.view.json"),
      },
      sourceLabel: t("workflows.nodeData.sourceLabel"),
      portsLabel: t("workflows.nodeData.portsLabel"),
      removedStep: t("workflows.nodeData.removedStep"),
      search: t("workflows.nodeData.search"),
      clearSearch: t("workflows.nodeData.clearSearch"),
      count: (count: number) => t("workflows.nodeData.count", { count }),
      ofTotal: (shown: number, total: number) =>
        t("workflows.nodeData.ofTotal", { shown, total }),
      noInputConnected: t("workflows.nodeData.noInputConnected"),
      noInputData: t("workflows.nodeData.noInputData"),
      testWorkflowHint: t("workflows.nodeData.testWorkflowHint"),
      testWorkflow: t("workflows.nodeData.testWorkflow"),
      noOutputData: t("workflows.nodeData.noOutputData"),
      previewHint: t("workflows.nodeData.previewHint"),
      noMatchingItems: t("workflows.nodeData.noMatchingItems"),
      noMatchingFields: t("workflows.nodeData.noMatchingFields"),
      onlyIds: t("workflows.nodeData.onlyIds"),
      hiddenColumns: t("workflows.nodeData.hiddenColumns"),
      truncated: t("workflows.nodeData.truncated"),
      moreFields: (count: number) =>
        t("workflows.nodeData.moreFields", { count }),
      runStarted: (when: string) =>
        t("workflows.nodeData.runStarted", { when }),
      runTook: (duration: string) =>
        t("workflows.nodeData.runTook", { duration }),
      copyPath: t("workflows.nodeData.copyPath"),
      pathCopied: t("workflows.nodeData.pathCopied"),
      pathCopyFailed: t("workflows.nodeData.pathCopyFailed"),
      dragHint: t("workflows.nodeData.dragHint"),
      mappedFirstField: t("workflows.nodeData.mappedFirstField"),
    }),
  });
}

export type WorkflowStrings = ReturnType<typeof createWorkflowStrings>;

export function useWorkflowStrings(): WorkflowStrings {
  const t = useT();
  return useMemo(() => createWorkflowStrings(t), [t]);
}
