type Props = {
  index: number;
  total: number;
  visible: boolean;
};

export default function OpenSlideProgressBar({ index, total, visible }: Props) {
  const progress = total > 0 ? (index + 1) / total : 0;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-border/50 transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="h-full w-full origin-left bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
