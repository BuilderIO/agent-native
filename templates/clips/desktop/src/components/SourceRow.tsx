import { CheckIcon, ChevronDown, MonitorIcon } from "./Icons";
import { useRowMenu } from "./useRowMenu";

export type CaptureSource = "full-screen" | "window" | "region";

const LABELS: Record<CaptureSource, string> = {
  "full-screen": "Full screen",
  window: "Window",
  region: "Region",
};

export function SourceRow({
  value,
  onChange,
  includeRegion = false,
}: {
  value: CaptureSource;
  onChange: (v: CaptureSource) => void;
  includeRegion?: boolean;
}) {
  const { open, setOpen, rowRef } = useRowMenu();
  const options = (
    includeRegion
      ? Object.keys(LABELS)
      : Object.keys(LABELS).filter((key) => key !== "region")
  ) as CaptureSource[];

  return (
    <div className="row row-on" ref={rowRef}>
      <span className="row-icon">
        <MonitorIcon />
      </span>
      <button
        type="button"
        className="row-button"
        onClick={() => setOpen((v) => !v)}
        title={LABELS[value]}
      >
        <span className="row-label">{LABELS[value]}</span>
        <span className="row-flex" aria-hidden />
        <span className="row-chev" aria-hidden>
          <ChevronDown />
        </span>
      </button>
      {open ? (
        <div className="row-menu" role="menu">
          {options.map((key) => {
            const isSelected = key === value;
            return (
              <button
                key={key}
                type="button"
                className={`row-menu-item ${isSelected ? "selected" : ""}`}
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChange(key);
                  setOpen(false);
                }}
              >
                <span className="row-menu-check" aria-hidden>
                  {isSelected ? <CheckIcon /> : null}
                </span>
                <span className="row-menu-label">{LABELS[key]}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
