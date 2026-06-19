type CaptureMode = "screen" | "screen-camera" | "camera";
type MacosPrivacyPane =
  | "camera"
  | "microphone"
  | "screen"
  | "speech"
  | "accessibility"
  | "input-monitoring";

type ReadinessItem = {
  label: string;
  detail: string;
  pane: MacosPrivacyPane;
  active: boolean;
};

function readinessItems({
  mode,
  cameraOn,
  micOn,
  includeFnMonitoring,
  includeVoicePaste,
}: {
  mode: CaptureMode;
  cameraOn: boolean;
  micOn: boolean;
  includeFnMonitoring: boolean;
  includeVoicePaste: boolean;
}): ReadinessItem[] {
  const items: ReadinessItem[] = [
    {
      label: "Screen Recording",
      detail: "Needed for screen or window capture.",
      pane: "screen",
      active: mode !== "camera",
    },
    {
      label: "Microphone",
      detail: "Needed when the mic is on.",
      pane: "microphone",
      active: micOn,
    },
    {
      label: "Speech Recognition",
      detail: "Used for native transcripts.",
      pane: "speech",
      active: micOn,
    },
    {
      label: "Camera",
      detail: "Needed when camera is on.",
      pane: "camera",
      active: mode !== "screen" && cameraOn,
    },
    {
      label: "Accessibility",
      detail: "Needed to paste dictated text into other apps.",
      pane: "accessibility",
      active: includeVoicePaste,
    },
    {
      label: "Input Monitoring",
      detail: "Only needed for the Fn dictation shortcut.",
      pane: "input-monitoring",
      active: includeFnMonitoring,
    },
  ];

  return items.filter((item) => item.active);
}

export function ReadinessPanel({
  mode,
  cameraOn,
  micOn,
  includeFnMonitoring,
  includeVoicePaste,
  open,
  onOpenChange,
  onOpenPermission,
}: {
  mode: CaptureMode;
  cameraOn: boolean;
  micOn: boolean;
  includeFnMonitoring: boolean;
  includeVoicePaste: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPermission: (pane: MacosPrivacyPane) => void;
}) {
  const items = readinessItems({
    mode,
    cameraOn,
    micOn,
    includeFnMonitoring,
    includeVoicePaste,
  });

  return (
    <div className={`readiness ${open ? "readiness-open" : ""}`}>
      <button
        type="button"
        className="readiness-summary"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span className="readiness-title">Setup</span>
        <span className="readiness-action">{open ? "Hide" : "Review"}</span>
      </button>
      {open ? (
        <div className="readiness-list">
          {items.length ? (
            items.map((item) => (
              <div className="readiness-item" key={item.pane}>
                <div className="readiness-item-copy">
                  <span className="readiness-item-title">{item.label}</span>
                  <span className="readiness-item-detail">{item.detail}</span>
                </div>
                <button
                  type="button"
                  className="readiness-open-button"
                  onClick={() => onOpenPermission(item.pane)}
                >
                  Open
                </button>
              </div>
            ))
          ) : (
            <div className="readiness-empty">
              Turn on camera or mic when you need them.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
