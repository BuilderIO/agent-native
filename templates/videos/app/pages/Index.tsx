import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, Navigate } from "react-router";
import { AgentSidebar } from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { compositions } from "@/remotion/registry";
import { Spinner } from "@/components/ui/spinner";
import { Sidebar } from "@/components/Sidebar";
import { StudioHeader } from "@/components/StudioHeader";
import { QuestionFlow } from "@/components/QuestionFlow";
import CompositionView from "@/pages/CompositionView";
import NewComposition from "@/pages/NewComposition";
import { CurrentElementProvider } from "@/contexts/CurrentElementContext";
import { CompositionProvider } from "@/contexts/CompositionContext";
import { TimelineProvider } from "@/contexts/TimelineContext";
import { PlaybackProvider } from "@/contexts/PlaybackContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import { useCompositionCollab } from "@/hooks/use-composition-collab";
import { useDatabaseCompositions } from "@/hooks/use-database-compositions";
import "@/utils/resetComposition"; // Make reset utility available in console

// ─── Studio Container with Providers ──────────────────────────────────────────

function StudioContent({
  collab,
}: {
  collab: ReturnType<typeof useCompositionCollab>;
}) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const initialSidebarSet = useRef(false);
  const { questions, handleSubmit, handleSkip } = useQuestionFlow();

  useEffect(() => {
    if (!initialSidebarSet.current && isMobile) {
      setSidebarOpen(false);
      initialSidebarSet.current = true;
    }
  }, [isMobile]);

  const [generatingComposition, setGeneratingComposition] = useState(false);
  const [cameraControlsTrigger, setCameraControlsTrigger] = useState(0);
  const [cursorControlsTrigger, setCursorControlsTrigger] = useState(0);
  const [compSettingsTrigger, setCompSettingsTrigger] = useState(0);

  const handleCameraKeyframeClick = useCallback(
    (trackType: "camera" | "cursor") => {
      if (trackType === "camera") {
        setCameraControlsTrigger((prev) => prev + 1);
      } else {
        setCursorControlsTrigger((prev) => prev + 1);
      }
    },
    [],
  );

  const handleCompSettingsClick = useCallback(() => {
    setCompSettingsTrigger((prev) => prev + 1);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <AgentSidebar
        position="right"
        defaultOpen
        emptyStateText="Ask me anything about your videos"
        suggestions={[
          "Create a new composition",
          "Add a camera pan effect",
          "Adjust the animation timing",
        ]}
      >
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <StudioHeader
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          />
          <InvitationBanner />
          <div className="flex flex-1 min-h-0 relative">
            <Sidebar
              open={sidebarOpen}
              cameraControlsTrigger={cameraControlsTrigger}
              cursorControlsTrigger={cursorControlsTrigger}
              compSettingsTrigger={compSettingsTrigger}
              onGeneratingChange={setGeneratingComposition}
            />

            <div className="flex-1 min-w-0 overflow-y-auto relative">
              {questions && questions.length > 0 ? (
                <div className="absolute inset-0 z-30 bg-background">
                  <QuestionFlow
                    questions={questions}
                    onSubmit={handleSubmit}
                    onSkip={handleSkip}
                  />
                </div>
              ) : null}
              <CompositionView
                onCameraKeyframeClick={handleCameraKeyframeClick}
                onCompSettingsClick={handleCompSettingsClick}
                isGenerating={generatingComposition}
                activeUsers={collab.activeUsers}
                agentActive={collab.agentActive}
                agentPresent={collab.agentPresent}
              />
            </div>
          </div>
        </div>
      </AgentSidebar>
    </div>
  );
}

// ─── Studio ───────────────────────────────────────────────────────────────────

export default function Studio() {
  const { compositionId } = useParams<{ compositionId: string }>();
  const dbCompositions = useDatabaseCompositions();
  const collab = useCompositionCollab(
    compositionId && compositionId !== "new" ? compositionId : null,
  );

  const isNew = compositionId === "new";
  const selected = compositions.find((c) => c.id === compositionId);
  const dbHasSelectedComposition =
    !!compositionId &&
    dbCompositions.rows.some((row) => row.id === compositionId);

  // ── Redirects ─────────────────────────────────────────────────────────────
  if (!compositionId && dbCompositions.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <Spinner className="size-8 text-foreground" />
      </div>
    );
  }

  if (!compositionId) {
    return compositions.length > 0 ? (
      <Navigate to={`c/${compositions[0].id}`} replace />
    ) : (
      <Navigate to="c/new" replace />
    );
  }

  if (
    !isNew &&
    !selected &&
    (dbCompositions.isLoading || dbHasSelectedComposition)
  ) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <Spinner className="size-8 text-foreground" />
      </div>
    );
  }

  if (!isNew && !selected) {
    return compositions.length > 0 ? (
      <Navigate to={`/c/${compositions[0].id}`} replace />
    ) : (
      <Navigate to="/c/new" replace />
    );
  }

  // ─── Provide context and render ───────────────────────────────────────────

  // For "new" composition, we still need providers but with placeholder values
  if (isNew) {
    return (
      <CurrentElementProvider>
        <CompositionProvider compositionId="new">
          <TimelineProvider>
            <PlaybackProvider>
              <div className="h-screen flex bg-background text-foreground overflow-hidden">
                <AgentSidebar
                  position="right"
                  defaultOpen
                  emptyStateText="Ask me anything about your videos"
                  suggestions={[
                    "Create a new composition",
                    "Add a camera pan effect",
                    "Adjust the animation timing",
                  ]}
                >
                  <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                    <StudioHeader sidebarOpen onToggleSidebar={() => {}} />
                    <InvitationBanner />
                    <div className="flex flex-1 min-h-0 relative">
                      <Sidebar
                        open
                        cameraControlsTrigger={0}
                        cursorControlsTrigger={0}
                        compSettingsTrigger={0}
                        onGeneratingChange={() => {}}
                      />
                      <div className="flex-1 min-w-0 overflow-y-auto">
                        <NewComposition isGenerating={false} />
                      </div>
                    </div>
                  </div>
                </AgentSidebar>
              </div>
            </PlaybackProvider>
          </TimelineProvider>
        </CompositionProvider>
      </CurrentElementProvider>
    );
  }

  // For existing composition, wrap with all providers
  if (!selected) return null;

  return (
    <CurrentElementProvider>
      <CompositionProvider
        compositionId={compositionId!}
        onCollabPush={collab.pushToCollab}
        collabData={collab.compositionData}
        collabSynced={collab.isSynced}
      >
        <TimelineProvider
          onCollabPush={collab.pushToCollab}
          collabData={collab.compositionData}
          collabSynced={collab.isSynced}
        >
          <PlaybackProvider>
            <StudioContent collab={collab} />
          </PlaybackProvider>
        </TimelineProvider>
      </CompositionProvider>
    </CurrentElementProvider>
  );
}
