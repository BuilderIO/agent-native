/**
 * Character count for a length-limited field. It stays out of the way until
 * the field is half full, then reads "count/max" and escalates at 80% and at
 * the limit (the source's indicator thresholds).
 */
export function CharacterCount({
  count,
  max,
  className,
}: {
  count: number;
  max: number;
  className?: string;
}) {
  const proportion = max === 0 ? 0 : count / max;
  if (proportion < 0.5) return null;
  const level =
    proportion > 1 ? "over" : proportion > 0.8 ? "warning" : "normal";
  return (
    <span
      className={`ws-char-count is-${level}${className === undefined ? "" : ` ${className}`}`}
      aria-live="polite"
    >
      {count}/{max}
    </span>
  );
}
