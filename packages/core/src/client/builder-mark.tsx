import React from "react";

/**
 * Builder.io monogram — simple B letterform on a rounded tile.
 * Shared by ConnectBuilderCard (chat) and UseBuilderCard (settings) so the
 * brand mark stays in lockstep across Builder-connect surfaces.
 */
export function BuilderBMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 116 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M115.14 39C115.14 17.36 97.58 0 76.14 0H10.27C4.58002 0 0 4.62002 0 10.27C0 20.79 22.2899 28.78 22.2899 65C22.2899 101.22 0 109.21 0 119.73C0 125.38 4.58002 130 10.27 130H76.14C97.58 130 115.14 112.64 115.14 91C115.14 75.1 105.59 65.41 105.21 65C105.58 64.59 115.14 54.9 115.14 39ZM13.58 11.1504H76.14C83.58 11.1504 90.58 14.0501 95.84 19.3101C101.1 24.5701 104 31.5703 104 39.0103C104 46.4503 101.26 53.0102 96.38 58.1602L13.59 11.1504H13.58ZM95.83 110.7C90.57 115.96 83.57 118.86 76.13 118.86H13.5699L96.36 71.8501C101.24 77.0001 103.98 83.8 103.98 91C103.98 98.2 101.08 105.44 95.8199 110.7H95.83ZM25.7 99.1602C26.36 97.7802 33.4199 84.08 33.4199 65C33.4199 45.92 26.36 32.2203 25.7 30.8403L85.86 65L25.7 99.1602Z"
        fill="currentColor"
      />
    </svg>
  );
}
