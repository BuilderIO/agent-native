/**
 * Self-contained i18n for the status-pages config sub-view. English is the
 * source of truth; other locales fall back per key. Reuses the uptime feature's
 * `fmt` interpolation helper.
 */
import { useLocale } from "@agent-native/core/client";

export { fmt } from "../i18n";

const MESSAGES = {
  "en-US": {
    // Entry / index
    title: "Status pages", // i18n-ignore feature-local i18n source
    subtitle: // i18n-ignore feature-local i18n source
      "Publish a public page that shows the live health of the monitors you choose.",
    back: "Back to monitors",
    backToPages: "Back to status pages",
    newPage: "New status page",
    emptyTitle: "No status pages yet", // i18n-ignore feature-local i18n source
    emptyDescription: // i18n-ignore feature-local i18n source
      "Create a public status page to share the live health of your monitors with customers or teammates.",
    emptyCta: "Create a status page",
    monitorsCount: "{count} monitors",
    oneMonitor: "1 monitor",
    noMonitorsOnPage: "No monitors yet",
    publishedBadge: "Published",
    draftBadge: "Draft",
    copyLink: "Copy link",
    copied: "Copied",
    openPage: "Open",
    edit: "Edit",
    delete: "Delete",
    // Delete dialog
    deleteTitle: "Delete status page?",
    deleteDescription:
      "This permanently deletes “{title}” and its public link at /status/{slug}.",
    deleteConfirm: "Delete",
    cancel: "Cancel",
    // Editor
    createTitle: "New status page",
    editTitle: "Edit status page",
    createSubtitle:
      "Give it a title and choose which monitors to show. Publish when you're ready to share.",
    editSubtitle: "Update what this page shows and who can see it.",
    save: "Save status page",
    saving: "Saving…",
    sectionBasics: "Basics",
    fieldTitle: "Title",
    fieldTitlePlaceholder: "Acme Status",
    fieldSlug: "Public URL",
    fieldSlugHint: "Lowercase letters, numbers, and dashes.",
    fieldDescription: "Description",
    fieldDescriptionPlaceholder: "Live status of Acme's services.",
    fieldPublished: "Published",
    fieldPublishedHint: "When on, anyone with the link can view this page.",
    linkLiveHint: "Live at {url} once published.",
    linkLive: "Live at {url}",
    sectionLayout: "Layout",
    fieldShowUptimeBars: "Uptime bars",
    fieldShowOverallUptime: "Overall uptime",
    fieldShowResponseTime: "Response time",
    fieldDensity: "Density",
    densityComfortable: "Comfortable",
    densityCompact: "Compact",
    fieldAlignment: "Alignment",
    alignmentLeft: "Left",
    alignmentCenter: "Center",
    sectionMonitors: "Monitors",
    sectionMonitorsHint: "Choose which monitors appear and in what order.",
    addMonitor: "Add a monitor",
    addMonitorPlaceholder: "Add a monitor…", // i18n-ignore feature-local i18n source
    noMonitorsSelected: "No monitors added yet.",
    noMonitorsAvailable: "All your monitors are already on this page.",
    createMonitorsFirst: "Create a monitor first, then add it here.",
    displayNamePlaceholder: "Display name (optional)",
    showUrl: "Show URL",
    moveUp: "Move up",
    moveDown: "Move down",
    remove: "Remove",
    // Preview
    sectionPreview: "Live preview",
    previewHint: "Reflects your last save.",
    previewSaveFirst: "Save the page to see a live preview.",
    previewDraftNote:
      "This page is a draft — publish it to make the link live.",
    // Validation / toasts
    titleRequired: "Give the page a title.",
    slugInvalid: "Use lowercase letters, numbers, and dashes.",
    savedToast: "Status page saved.",
    saveFailed: "Could not save status page: {message}",
    deletedToast: "Status page deleted.",
    deleteFailed: "Could not delete status page: {message}",
    copyFailed: "Could not copy the link.",
  },
} as const;

type StatusPagesMessages = (typeof MESSAGES)["en-US"];

export function useStatusPagesT(): StatusPagesMessages {
  const { locale } = useLocale();
  return {
    ...MESSAGES["en-US"],
    ...((MESSAGES as Record<string, Partial<StatusPagesMessages>>)[locale] ??
      {}),
  };
}
