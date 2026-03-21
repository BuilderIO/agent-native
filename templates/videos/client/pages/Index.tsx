import { useState, useCallback } from "react";
import { useParams, Navigate } from "react-router";
import { compositions } from "@/remotion/registry";
import { Sidebar } from "@/components/Sidebar";
import { StudioHeader } from "@/components/StudioHeader";
import CompositionView from "@/pages/CompositionView";
import NewComposition from "@/pages/NewComposition";
import { CurrentElementProvider } from "@/contexts/CurrentElementContext";
import { CompositionProvider } from "@/contexts/CompositionContext";
import { TimelineProvider } from "@/contexts/TimelineContext";
import { PlaybackProvider } from "@/contexts/PlaybackContext";
import "@/utils/resetComposition"; // Make reset utility available in console

// ─── Studio Container with Providers ──────────────────────────────────────────

function StudioContent() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
      <StudioHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          open={sidebarOpen}
          cameraControlsTrigger={cameraControlsTrigger}
          cursorControlsTrigger={cursorControlsTrigger}
          compSettingsTrigger={compSettingsTrigger}
          onGeneratingChange={setGeneratingComposition}
        />

        <div className="flex-1 min-w-0 overflow-y-auto">
          <CompositionView
            onCameraKeyframeClick={handleCameraKeyframeClick}
            onCompSettingsClick={handleCompSettingsClick}
            isGenerating={generatingComposition}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Studio ───────────────────────────────────────────────────────────────────

export default function Studio() {
  const { compositionId } = useParams<{ compositionId: string }>();

  const isNew = compositionId === "new";
  const selected = compositions.find((c) => c.id === compositionId);

  // ── Redirects ─────────────────────────────────────────────────────────────
  if (!compositionId) {
    return compositions.length > 0 ? (
      <Navigate to={`/c/${compositions[0].id}`} replace />
    ) : (
      <Navigate to="/c/new" replace />
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
              <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
                <StudioHeader sidebarOpen onToggleSidebar={() => {}} />
                <div className="flex flex-1 min-h-0">
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
      <CompositionProvider compositionId={compositionId!}>
        <TimelineProvider>
          <PlaybackProvider>
            <StudioContent />
          </PlaybackProvider>
        </TimelineProvider>
      </CompositionProvider>
    </CurrentElementProvider>
  );
}
