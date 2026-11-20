export function LogoMark({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <path d="M8.5 9h7M8.5 13h7M8.5 17h3.5" />
    </svg>
  );
}
