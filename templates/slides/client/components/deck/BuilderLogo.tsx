interface BuilderLogoProps {
  className?: string;
}

/** Builder.io "B" logo extracted from the official builder-logo-white.svg */
export default function BuilderLogo({
  className = "w-7 h-7",
}: BuilderLogoProps) {
  return (
    <svg
      viewBox="0 0 71 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M70.86 24C70.86 10.69 60.06 0 46.86 0H6.32C2.82 0 0 2.84 0 6.32C0 12.8 13.71 17.71 13.71 40C13.71 62.29 0 67.21 0 73.68C0 77.16 2.82 80 6.32 80H46.86C60.06 80 70.86 69.31 70.86 56C70.86 46.22 64.98 40.25 64.75 40C64.98 39.75 70.86 33.78 70.86 24ZM8.37 6.86H46.87C51.45 6.86 55.75 8.64 58.99 11.88C62.23 15.12 64.01 19.42 64.01 24C64.01 28.58 62.32 32.62 59.32 35.79L8.37 6.86ZM58.99 68.13C55.75 71.37 51.45 73.15 46.87 73.15H8.37L59.32 44.22C62.32 47.39 64.01 51.57 64.01 56.01C64.01 60.45 62.23 64.89 58.99 68.13ZM15.83 61.02C16.24 60.17 20.58 51.74 20.58 40C20.58 28.26 16.24 19.83 15.83 18.98L52.85 40L15.83 61.02Z"
        fill="currentColor"
      />
    </svg>
  );
}
