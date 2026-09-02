/**
 * Full-bleed rendering of the faux Clips Library + tray popover, kept as a
 * screenshot surface. The real popover is a Tauri window excluded from screen
 * capture (`set_capture_excluded` in
 * templates/clips/desktop/src-tauri/src/lib.rs), so it cannot be captured from
 * the OS — this route renders the recreation at a comfortable window size.
 *
 * The composition itself lives in ClipsLibraryMock, which is also the Clips
 * landing-page hero art.
 */
import { ClipsLibraryMock } from "../components/template-landing/ClipsLibraryMock";

export default function ClipsReadyToRecordPreview() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0c0c0c",
      }}
    >
      <ClipsLibraryMock
        label="Clips library with the recorder popover open"
        className="h-full max-h-[700px] w-full max-w-[1200px] rounded-[10px]"
      />
    </div>
  );
}
