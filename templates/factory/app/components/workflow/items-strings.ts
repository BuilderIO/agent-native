import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import {
  lazyGroups,
  type NamespaceKey,
  type Translate,
} from "@/lib/typed-translate";

type ItemsKey = NamespaceKey<"items" | "journey" | "activity" | "audit">;

/** Every string the Items, Activity, item journey, and node audit views show, read from the `items.*`, `journey.*`, `activity.*` and `audit.*` catalog keys. */
export function createItemsStrings(t: Translate<ItemsKey>) {
  return lazyGroups({
    items: () => ({
      filterGroupLabel: t("items.filterGroupLabel"),
      filter: {
        needsYou: t("items.filter.needsYou"),
        parked: t("items.filter.parked"),
        dismissed: t("items.filter.dismissed"),
        all: t("items.filter.all"),
      },
      workflowLabel: t("items.workflowLabel"),
      allWorkflows: t("items.allWorkflows"),
      sourceLabel: t("items.sourceLabel"),
      allSources: t("items.allSources"),
      searchLabel: t("items.searchLabel"),
      searchBy: t("items.searchBy"),
      untitled: t("items.untitled"),
      loadMore: t("items.loadMore"),
      clearFilters: t("items.clearFilters"),
      empty: {
        needsYou: t("items.empty.needsYou"),
        parked: t("items.empty.parked"),
        dismissed: t("items.empty.dismissed"),
        all: t("items.empty.all"),
        filtered: t("items.empty.filtered"),
      },
      sheetTitle: (title: string) => t("items.sheetTitle", { title }),
    }),
    source: () =>
      ({
        slack: "Slack",
        github: "GitHub",
        github_issue: t("items.source.github_issue"),
        sentry: "Sentry",
        hubspot: "HubSpot",
        pylon: "Pylon",
        stripe: "Stripe",
        gong: "Gong",
        jira: "Jira",
        notion: "Notion",
        posthog: "PostHog",
        bigquery: "BigQuery",
        builder: "Builder",
        email: t("items.source.email"),
      }) as Record<string, string>,
    status: () =>
      ({
        received: t("items.status.received"),
        context_fetching: t("items.status.context_fetching"),
        evidence_ready: t("items.status.evidence_ready"),
        classified: t("items.status.classified"),
        shadow_decided: t("items.status.shadow_decided"),
        needs_manual: t("items.status.needs_manual"),
        failed: t("items.status.failed"),
        reconciliation_required: t("items.status.reconciliation_required"),
        automation_started: t("items.status.automation_started"),
        pr_observed: t("items.status.pr_observed"),
        auto_approved: t("items.status.auto_approved"),
        merged: t("items.status.merged"),
        resolved: t("items.status.resolved"),
        dismissed: t("items.status.dismissed"),
      }) as Record<string, string>,
    phase: () => ({
      needsYou: t("items.phase.needsYou"),
      waiting: t("items.phase.waiting"),
      inFlow: t("items.phase.inFlow"),
    }),
    needsYouReason: () =>
      ({
        handed_off: t("items.needsYouReason.handed_off"),
        attempts_exhausted: t("items.needsYouReason.attempts_exhausted"),
        effect_needs_check: t("items.needsYouReason.effect_needs_check"),
      }) as Record<string, string>,
    where: () => ({
      atNode: (node: string) => t("items.where.atNode", { node }),
      parkedReply: (until: string) => t("items.where.parkedReply", { until }),
      parkedTime: (until: string) => t("items.where.parkedTime", { until }),
      parkedCondition: (until: string) =>
        t("items.where.parkedCondition", { until }),
      nodeRemoved: t("items.where.nodeRemoved"),
      notStarted: t("items.where.notStarted"),
    }),
    time: () => ({
      today: t("items.time.today"),
      yesterday: t("items.time.yesterday"),
    }),
    duration: () => ({
      ms: (value: number) => t("items.duration.ms", { value }),
      seconds: (value: string) => t("items.duration.seconds", { value }),
      minutes: (minutes: number, seconds: number) =>
        seconds === 0
          ? t("items.duration.minutes", { minutes })
          : t("items.duration.minutesSeconds", { minutes, seconds }),
    }),
    mode: () => ({
      live: t("items.mode.live"),
      dry: t("items.mode.dry"),
      test: t("items.mode.test"),
    }),
    error: () => ({
      title: {
        generic: t("items.error.title.generic"),
        workflow_not_found: t("items.error.title.workflow_not_found"),
        workflow_item_not_found: t("items.error.title.workflow_item_not_found"),
        workflow_node_not_found: t("items.error.title.workflow_node_not_found"),
        factory_not_found: t("items.error.title.factory_not_found"),
        bad_cursor: t("items.error.title.bad_cursor"),
        stored_record_unreadable: t(
          "items.error.title.stored_record_unreadable",
        ),
        action_unavailable: t("items.error.title.action_unavailable"),
      },
      detail: {
        bad_cursor: t("items.error.detail.bad_cursor"),
        stored_record_unreadable: t(
          "items.error.detail.stored_record_unreadable",
        ),
        action_unavailable: (action: string) =>
          t("items.error.detail.action_unavailable", { action }),
      },
      dangling: t("items.error.dangling"),
      retry: t("items.error.retry"),
      startOver: t("items.error.startOver"),
      codeLabel: (code: string) => t("items.error.codeLabel", { code }),
    }),
    journey: () => ({
      openOnCanvas: t("journey.openOnCanvas"),
      askAgent: t("journey.askAgent"),
      retry: t("journey.retry"),
      retryDialogTitle: t("journey.retryDialogTitle"),
      retryDialogBody: t("journey.retryDialogBody"),
      retryFailed: (reason: string) => t("journey.retryFailed", { reason }),
      dismiss: t("journey.dismiss"),
      dismissFailed: (reason: string) => t("journey.dismissFailed", { reason }),
      close: t("journey.close"),
      openInSource: (source: string) => t("journey.openInSource", { source }),
      sourceLink: t("journey.sourceLink"),
      inWorkflow: (workflow: string) => t("journey.inWorkflow", { workflow }),
      graphLabel: t("journey.graphLabel"),
      graphLoading: t("journey.graphLoading"),
      pathRemoved: (count: number) => t("journey.pathRemoved", { count }),
      timelineHeading: t("journey.timelineHeading"),
      noEvents: t("journey.noEvents"),
      loadOlder: t("journey.loadOlder"),
      run: (when: string) => t("journey.run", { when }),
      openRun: t("journey.openRun"),
      receiptsHeading: t("journey.receiptsHeading"),
      noReceipts: t("journey.noReceipts"),
      receiptsTruncated: (count: number) =>
        t("journey.receiptsTruncated", { count }),
      receiptState: {
        started: t("journey.receiptState.started"),
        done: t("journey.receiptState.done"),
        failed: t("journey.receiptState.failed"),
      },
      receiptNoRef: t("journey.receiptNoRef"),
      receiptOpen: t("journey.receiptOpen"),
      showMore: t("journey.showMore"),
      showLess: t("journey.showLess"),
      summaryTruncated: t("journey.summaryTruncated"),
      parked: {
        reply: (node: string) => t("journey.parked.reply", { node }),
        time: (node: string) => t("journey.parked.time", { node }),
        condition: (node: string) => t("journey.parked.condition", { node }),
        due: (when: string) => t("journey.parked.due", { when }),
        nextCheck: (when: string) => t("journey.parked.nextCheck", { when }),
        checkDue: t("journey.parked.checkDue"),
        watching: t("journey.parked.watching"),
        slackThread: (channel: string) =>
          t("journey.parked.slackThread", { channel }),
        pullRequest: (repo: string | undefined, number: number) =>
          repo ? `${repo}#${number}` : `#${number}`,
        ticket: (id: string) => t("journey.parked.ticket", { id }),
      },
      lease: {
        held: (by: string, until: string) =>
          t("journey.lease.held", { by, until }),
        expired: (by: string) => t("journey.lease.expired", { by }),
      },
      attempts: (count: number) => t("journey.attempts", { count }),
      syntheticNote: t("journey.syntheticNote"),
      event: {
        taken: (node: string | null) =>
          node
            ? t("journey.event.taken", { node })
            : t("journey.event.takenNoNode"),
        entered: (node: string | null) =>
          node
            ? t("journey.event.entered", { node })
            : t("journey.event.enteredNoNode"),
        output: (node: string | null) =>
          node
            ? t("journey.event.output", { node })
            : t("journey.event.outputNoNode"),
        decision: (node: string | null) =>
          node
            ? t("journey.event.decision", { node })
            : t("journey.event.decisionNoNode"),
        effect: (node: string | null) =>
          node
            ? t("journey.event.effect", { node })
            : t("journey.event.effectNoNode"),
        parked: (node: string | null) =>
          node
            ? t("journey.event.parked", { node })
            : t("journey.event.parkedNoNode"),
        woke: (node: string | null) =>
          node
            ? t("journey.event.woke", { node })
            : t("journey.event.wokeNoNode"),
        ended: (outcome: string) => t("journey.event.ended", { outcome }),
        endedPlain: t("journey.event.endedPlain"),
        error: (node: string | null) =>
          node
            ? t("journey.event.error", { node })
            : t("journey.event.errorNoNode"),
        port: (port: string) => t("journey.event.port", { port }),
      },
      outcome: {
        done: t("journey.outcome.done"),
        dismissed: t("journey.outcome.dismissed"),
        needsManual: t("journey.outcome.needsManual"),
        released: t("journey.outcome.released"),
      } as Record<string, string>,
      askMessage: t("journey.askMessage"),
    }),
    activity: () => ({
      filterGroupLabel: t("activity.filterGroupLabel"),
      kind: {
        all: t("activity.kind.all"),
        run: t("activity.kind.run"),
        change: t("activity.kind.change"),
        needs_you: t("activity.kind.needs_you"),
      },
      kindChip: {
        run: t("activity.kindChip.run"),
        change: t("activity.kindChip.change"),
        needs_you: t("activity.kindChip.needs_you"),
      },
      workflowLabel: t("activity.workflowLabel"),
      allWorkflows: t("activity.allWorkflows"),
      whoLabel: t("activity.whoLabel"),
      who: {
        all: t("activity.who.all"),
        person: t("activity.who.person"),
        agent: t("activity.who.agent"),
        schedule: t("activity.who.schedule"),
      },
      rangeLabel: t("activity.rangeLabel"),
      range: {
        day: t("activity.range.day"),
        week: t("activity.range.week"),
        month: t("activity.range.month"),
        all: t("activity.range.all"),
      },
      actor: {
        person: t("activity.actor.person"),
        agent: t("activity.actor.agent"),
        service: t("activity.actor.service"),
        schedule: t("activity.actor.schedule"),
      },
      unknownWorkflow: t("activity.unknownWorkflow"),
      loadMore: t("activity.loadMore"),
      empty: {
        filtered: t("activity.empty.filtered"),
        all: t("activity.empty.all"),
      },
      runStatus: {
        running: t("activity.runStatus.running"),
        succeeded: t("activity.runStatus.succeeded"),
        failed: t("activity.runStatus.failed"),
        paused: t("activity.runStatus.paused"),
      },
      runCounts: {
        taken: (count: number) => t("activity.runCounts.taken", { count }),
        done: (count: number) => t("activity.runCounts.done", { count }),
        dismissed: (count: number) =>
          t("activity.runCounts.dismissed", { count }),
        needsManual: (count: number) =>
          t("activity.runCounts.needsManual", { count }),
        released: (count: number) =>
          t("activity.runCounts.released", { count }),
        itemFailures: (count: number) =>
          t("activity.runCounts.itemFailures", { count }),
        needsCheck: (count: number) =>
          t("activity.runCounts.needsCheck", { count }),
        nothing: t("activity.runCounts.nothing"),
        summary: (head: string, parts: string) =>
          t("activity.runCounts.summary", { head, parts }),
      },
      change: {
        created: t("activity.change.created"),
        saved: t("activity.change.saved"),
        enabled: t("activity.change.enabled"),
        disabled: t("activity.change.disabled"),
        restored: t("activity.change.restored"),
        deleted: t("activity.change.deleted"),
        other: t("activity.change.other"),
      },
      changeText: {
        created: t("activity.changeText.created"),
        saved: (version: number | null) =>
          version === null
            ? t("activity.changeText.savedNoVersion")
            : t("activity.changeText.saved", { version }),
        enabled: t("activity.changeText.enabled"),
        disabled: t("activity.changeText.disabled"),
        restored: (version: number | null) =>
          version === null
            ? t("activity.changeText.restoredNoVersion")
            : t("activity.changeText.restored", { version }),
        deleted: t("activity.changeText.deleted"),
        other: t("activity.changeText.other"),
      },
      handedOff: (title: string) => t("activity.handedOff", { title }),
      link: {
        run: t("activity.link.run"),
        version: (version: number | null) =>
          version === null
            ? t("activity.link.openWorkflow")
            : t("activity.link.version", { version }),
        item: t("activity.link.item"),
      },
    }),
    listSeparator: () => t("items.listSeparator"),
    audit: () => ({
      close: t("audit.close"),
      askAgent: t("audit.askAgent"),
      askMessage: t("audit.askMessage"),
      scopedToRun: (when: string) => t("audit.scopedToRun", { when }),
      summaryHeading: t("audit.summaryHeading"),
      runsCount: (count: number) => t("audit.runsCount", { count }),
      failureRate: (percent: string) => t("audit.failureRate", { percent }),
      noFailures: t("audit.noFailures"),
      neverRan: t("audit.neverRan"),
      moreRuns: t("audit.moreRuns"),
      duration: (p50: string, p95: string) => t("audit.duration", { p50, p95 }),
      modes: (live: number, dry: number, test: number) =>
        [
          t("audit.modeLive", { count: live }),
          ...(dry > 0 ? [t("audit.modeDry", { count: dry })] : []),
          ...(test > 0 ? [t("audit.modeTest", { count: test })] : []),
        ].join(t("items.listSeparator")),
      stepStatus: {
        running: t("audit.stepStatus.running"),
        succeeded: t("audit.stepStatus.succeeded"),
        failed: t("audit.stepStatus.failed"),
        skipped: t("audit.stepStatus.skipped"),
        needs_check: t("audit.stepStatus.needs_check"),
      },
      latestHeading: t("audit.latestHeading"),
      inHeading: t("audit.inHeading"),
      outHeading: t("audit.outHeading"),
      fromNode: (count: number, node: string, port: string) =>
        t("audit.fromNode", { count, node, port }),
      portCount: (port: string, count: number) =>
        t("audit.portCount", { port, count }),
      parkedCount: t("audit.parkedCount"),
      nothingIn: t("audit.nothingIn"),
      nothingOut: t("audit.nothingOut"),
      moreItems: (shown: number, total: number) =>
        t("audit.moreItems", { shown, total }),
      noSummary: t("audit.noSummary"),
      stepInput: t("audit.stepInput"),
      stepTruncated: (available: number) =>
        t("audit.stepTruncated", { available }),
      errorsHeading: t("audit.errorsHeading"),
      noErrors: t("audit.noErrors"),
      errorSteps: (count: number) => t("audit.errorSteps", { count }),
      itemErrorsHeading: t("audit.itemErrorsHeading"),
      receiptsHeading: t("audit.receiptsHeading"),
      noReceipts: t("audit.noReceipts"),
      receiptsTruncated: t("audit.receiptsTruncated"),
      missingReceipts: (count: number) => t("audit.missingReceipts", { count }),
      openRun: t("audit.openRun"),
      openItem: t("audit.openItem"),
      atVersion: (version: number) => t("audit.atVersion", { version }),
    }),
  });
}

export type ItemsStrings = ReturnType<typeof createItemsStrings>;

export function useItemsStrings(): ItemsStrings {
  const t = useT();
  return useMemo(() => createItemsStrings(t), [t]);
}
