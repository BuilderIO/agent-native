// The standalone symbol from the wordmark, inked with `currentColor` so it
// keeps contrast on any surface. The public /agent-native-icon-*.svg files are
// download assets with baked-in black/white fills and are not safe inline.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 37.2656 21.5"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M8.02637 21.5H0L4.93164 12.8994L12.3262 0L19.7744 12.8994H12.958L8.02637 21.5Z"
        fill="currentColor"
      />
      <path
        d="M29.239 0H37.2656L24.9391 21.5H16.9126L29.239 0Z"
        fill="currentColor"
      />
    </svg>
  );
}
