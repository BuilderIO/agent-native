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
