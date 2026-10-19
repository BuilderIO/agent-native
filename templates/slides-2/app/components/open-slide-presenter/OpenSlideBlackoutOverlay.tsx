type Props = {
  mode: "black" | "white" | null;
};

export default function OpenSlideBlackoutOverlay({ mode }: Props) {
  if (!mode) return null;
  const blackoutClass = `pointer-events-none absolute inset-0 z-20 motion-safe:transition-opacity motion-safe:duration-150 ${
    mode === "black"
      ? /* guard:allow-raw-color — blackout must be absolute black. */ "bg-black"
      : /* guard:allow-raw-color — whiteout must be absolute white. */ "bg-white"
  }`; // guard:allow-raw-color — blackout must be absolute black or white
  return <div aria-hidden="true" className={blackoutClass} />;
}
