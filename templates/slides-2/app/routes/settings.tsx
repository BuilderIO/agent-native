import { useT } from "@agent-native/core/client/i18n";
import { buildSettingsRoute } from "@agent-native/core/client/navigation";
import { useOrg } from "@agent-native/core/client/org";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
import {
  createCreativeContextAgentTab,
  useCreativeContextLab,
  type CreativeContextAgentTabFactory,
} from "@agent-native/creative-context/client";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { ObservabilityDashboard } from "@agent-native/toolkit/app/observability";
import {
  AccountSettingsCard,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/toolkit/app/settings";
import { SLIDES_LABS } from "@shared/labs";
import { IconActivity } from "@tabler/icons-react";
import { useMemo } from "react";

import {
  COMMENT_EMAILS_ROW_ID,
  NotificationSettings,
} from "@/components/settings/notification-settings";
import messages from "@/i18n/en-US";
import { localizeSlidesChangelog } from "@/lib/localize-slides-changelog";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: messages.raw.routeSettingsTitle }];
}

// Settings gives the library its own page and header.
const createCreativeContextSettingsTab: CreativeContextAgentTabFactory = (
  context,
) => createCreativeContextAgentTab({ ...context, variant: "settings" });

export default function SettingsRoute() {
  const t = useT();
  const localizedChangelog = localizeSlidesChangelog(changelog, {
    editorHoveredObjects: t("slidesChangelog.editorHoveredObjects"),
    deckEditingControls: t("slidesChangelog.deckEditingControls"),
    googleSlidesMissingImageData: t(
      "slidesChangelog.googleSlidesMissingImageData",
    ),
    globalMediaPickerScope: t("slidesChangelog.globalMediaPickerScope"),
    presenterControls: t("slidesChangelog.presenterControls"),
    presenterBuildStepPreview: t("slidesChangelog.presenterBuildStepPreview"),
    presenterBuildStepBounds: t("slidesChangelog.presenterBuildStepBounds"),
    staleSlidePreviews: t("slidesChangelog.staleSlidePreviews"),
    boundedMediaTransfers: t("slidesChangelog.boundedMediaTransfers"),
    editorCanvasAppTheme: t("slidesChangelog.editorCanvasAppTheme"),
    editorInspectorTextControls: t(
      "slidesChangelog.editorInspectorTextControls",
    ),
    savedSlideImages: t("slidesChangelog.savedSlideImages"),
    keyboardObjectTransforms: t("slidesChangelog.keyboardObjectTransforms"),
    editorToolbarInspector: t("slidesChangelog.editorToolbarInspector"),
    commandMenuTheme: t("slidesChangelog.commandMenuTheme"),
    skippedSlidePresentation: t("slidesChangelog.skippedSlidePresentation"),
    browseDeckVersions: t("slidesChangelog.browseDeckVersions"),
    frameMissObjectSelection: t("slidesChangelog.frameMissObjectSelection"),
    commandMenuShortcut: t("slidesChangelog.commandMenuShortcut"),
    crossDeckSlideCopy: t("slidesChangelog.crossDeckSlideCopy"),
    completedSlideGeneration: t("slidesChangelog.completedSlideGeneration"),
    deckTitleAndNotesLabel: t("slidesChangelog.deckTitleAndNotesLabel"),
    deleteFocusedCanvasObject: t("slidesChangelog.deleteFocusedCanvasObject"),
    deleteSelectedSlideObject: t("slidesChangelog.deleteSelectedSlideObject"),
    slideOverviewFromRail: t("slidesChangelog.slideOverviewFromRail"),
    presenterKeyboardNavigation: t(
      "slidesChangelog.presenterKeyboardNavigation",
    ),
    sourceBackedPdfExport: t("slidesChangelog.sourceBackedPdfExport"),
    preserveDeckBriefOnRegeneration: t(
      "slidesChangelog.preserveDeckBriefOnRegeneration",
    ),
    jumpToSlideByNumber: t("slidesChangelog.jumpToSlideByNumber"),
    mobileNavigationAndSlideChat: t(
      "slidesChangelog.mobileNavigationAndSlideChat",
    ),
    lightExtraBoldText: t("slidesChangelog.lightExtraBoldText"),
    thumbnailArrowNavigation: t("slidesChangelog.thumbnailArrowNavigation"),
    homePromptDeckContinuity: t("slidesChangelog.homePromptDeckContinuity"),
    slideTransitions: t("slidesChangelog.slideTransitions"),
    editorPanelWidthsAndRecovery: t(
      "slidesChangelog.editorPanelWidthsAndRecovery",
    ),
    editorRailAndInspectorAlignment: t(
      "slidesChangelog.editorRailAndInspectorAlignment",
    ),
    chatEditPreviewVersion: t("slidesChangelog.chatEditPreviewVersion"),
    objectCommentsStayAttached: t("slidesChangelog.objectCommentsStayAttached"),
    agentTextSelectionStability: t(
      "slidesChangelog.agentTextSelectionStability",
    ),
    templateDeckChatPreviews: t("slidesChangelog.templateDeckChatPreviews"),
    consistentSlideTextSpacing: t("slidesChangelog.consistentSlideTextSpacing"),
    renderFailuresCanvasMessage: t(
      "slidesChangelog.renderFailuresCanvasMessage",
    ),
    editorPageCountFooter: t("slidesChangelog.editorPageCountFooter"),
    presentButtonReferenceAccent: t(
      "slidesChangelog.presentButtonReferenceAccent",
    ),
    positionFieldsPreserveRotatedSize: t(
      "slidesChangelog.positionFieldsPreserveRotatedSize",
    ),
    selectedSlideArrowNavigation: t(
      "slidesChangelog.selectedSlideArrowNavigation",
    ),
    chatPreviewStaleContent: t("slidesChangelog.chatPreviewStaleContent"),
    deleteGlobalSlideImages: t("slidesChangelog.deleteGlobalSlideImages"),
    presenterSpaceActivation: t("slidesChangelog.presenterSpaceActivation"),
    presenterPageUpPageDown: t("slidesChangelog.presenterPageUpPageDown"),
    presenterJumpCancellation: t("slidesChangelog.presenterJumpCancellation"),
    presenterBlankScreensAndNotes: t(
      "slidesChangelog.presenterBlankScreensAndNotes",
    ),
    restoreDeckVersionAgainstStaleEdits: t(
      "slidesChangelog.restoreDeckVersionAgainstStaleEdits",
    ),
    singleSlideRevealPreview: t("slidesChangelog.singleSlideRevealPreview"),
    agentConnectionStatus: t("slidesChangelog.agentConnectionStatus"),
    svgPatternScaleRotation: t("slidesChangelog.svgPatternScaleRotation"),
    sourceBackedClickAndPointer: t(
      "slidesChangelog.sourceBackedClickAndPointer",
    ),
    commandMenuUndoRedoShortcuts: t(
      "slidesChangelog.commandMenuUndoRedoShortcuts",
    ),
    overlappingTextInlineEdit: t("slidesChangelog.overlappingTextInlineEdit"),
    presenterViewAlignment: t("slidesChangelog.presenterViewAlignment"),
    softerSlideFrameShadow: t("slidesChangelog.softerSlideFrameShadow"),
    presenterTouchNavigation: t("slidesChangelog.presenterTouchNavigation"),
    lightCanvasBorderedSurface: t("slidesChangelog.lightCanvasBorderedSurface"),
    exactSlideTextFontSize: t("slidesChangelog.exactSlideTextFontSize"),
    arrowKeysMoveSelectedObjects: t(
      "slidesChangelog.arrowKeysMoveSelectedObjects",
    ),
    redoKeyboardShortcuts: t("slidesChangelog.redoKeyboardShortcuts"),
    importImageDataAndPreviewSync: t(
      "slidesChangelog.importImageDataAndPreviewSync",
    ),
  });
  const creativeContextEnabled = useCreativeContextLab();
  const {
    data: activeOrg,
    isLoading: orgLoading,
    isError: orgError,
  } = useOrg();
  const agentSettingsTabs = useAgentSettingsTabs({
    agentAdditionalTabFactories: creativeContextEnabled
      ? [createCreativeContextSettingsTab]
      : [],
  });
  const observabilityBasePath = buildSettingsRoute("observability");
  // Observability is a Slides page at its Settings path, so its nav item must
  // not carry `href`: that renders it as a link out of Settings.
  const observabilityTabs =
    !orgLoading &&
    !orgError &&
    activeOrg?.orgId &&
    (activeOrg.role === "owner" || activeOrg.role === "admin")
      ? [
          {
            id: "observability",
            label: t("settings.agentObservability"),
            icon: IconActivity,
            group: "agent",
            content: (
              <ObservabilityDashboard
                routeBasePath={observabilityBasePath}
                showHumanReview
              />
            ),
          },
        ]
      : [];
  const settingsTabs = [...agentSettingsTabs, ...observabilityTabs];
  useSetPageTitle(t("settings.title"));
  const labs = useMemo(
    () => [
      ...SLIDES_LABS.map((lab) => ({
        ...lab,
        displayName: t("deckEditor.layoutOverflowWarning"),
        description: t("settings.labLayoutOverflowWarningDescription"),
      })),
      {
        ...CREATIVE_CONTEXT_LIBRARY_LAB,
        displayName: t("creativeContext.share.title"),
        description: t("creativeContext.description"),
      },
    ],
    [t],
  );

  const notificationsSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "slides-comment-emails",
        label: t("settings.commentsAndReplies"),
        keywords: "email notifications deck comments replies alerts",
        hash: COMMENT_EMAILS_ROW_ID,
      },
    ],
    [t],
  );

  // Language lives on Account › Preferences, comment emails on the
  // Notifications page, and the library on its own page, so Slides adds no
  // groups to its General page.
  return (
    <SettingsTabsPage
      notifications={<NotificationSettings />}
      notificationsSearchEntries={notificationsSearchEntries}
      account={<AccountSettingsCard />}
      extraTabs={settingsTabs}
      labs={labs}
      labsIntro={t("settings.labsIntro")}
      labsLabel={t("settings.labs")}
      mcpAbout={t("settings.mcpAbout")}
      whatsNewMarkdown={localizedChangelog}
    />
  );
}
