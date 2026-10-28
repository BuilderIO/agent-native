import type { SVGProps } from "react";

export type GoogleProduct =
  | "calendar"
  | "docs"
  | "drive"
  | "gmail"
  | "sheets"
  | "slides";

const GOOGLE_MARK_COLORS = {
  // guard:allow-raw-color - official Google product mark color
  blue: "#4285F4",
  // guard:allow-raw-color - official Google product mark color
  blueDark: "#1A73E8",
  // guard:allow-raw-color - official Google product mark color
  blueLight: "#8AB4F8",
  // guard:allow-raw-color - official Google product mark color
  border: "#DADCE0",
  // guard:allow-raw-color - official Google product mark color
  green: "#34A853",
  // guard:allow-raw-color - official Google product mark color
  greenDark: "#188038",
  // guard:allow-raw-color - official Google product mark color
  red: "#EA4335",
  // guard:allow-raw-color - official Google product mark color
  yellow: "#FBBC04",
  // guard:allow-raw-color - official Google product mark color
  yellowDark: "#F9AB00",
} as const;

const commonProps: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true,
  focusable: false,
};

export function GoogleProductLogo({
  product,
  className,
  ...props
}: { product: GoogleProduct } & Omit<SVGProps<SVGSVGElement>, "children">) {
  const svgProps = { ...commonProps, className, ...props };

  switch (product) {
    case "gmail":
      return (
        <svg {...svgProps}>
          <path
            d="M3.5 5.25h17A1.5 1.5 0 0 1 22 6.75v10.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17.25V6.75a1.5 1.5 0 0 1 1.5-1.5Z"
            fill="white"
            stroke={GOOGLE_MARK_COLORS.border}
          />
          <path
            d="m3 7 9 6.75L21 7"
            stroke={GOOGLE_MARK_COLORS.red}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 17.75V7m18 10.75V7"
            stroke={GOOGLE_MARK_COLORS.blue}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="m3 7 4.25 3.2"
            stroke={GOOGLE_MARK_COLORS.yellow}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="m21 7-4.25 3.2"
            stroke={GOOGLE_MARK_COLORS.green}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg {...svgProps}>
          <rect
            x="3"
            y="4"
            width="18"
            height="17"
            rx="2.5"
            fill={GOOGLE_MARK_COLORS.blue}
          />
          <path d="M3 9h18" stroke="white" strokeWidth="2" />
          <path
            d="M7 3v3M17 3v3"
            stroke={GOOGLE_MARK_COLORS.blueDark}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <text
            x="12"
            y="17"
            textAnchor="middle"
            fill="white"
            fontFamily="Arial, sans-serif"
            fontSize="8"
            fontWeight="700"
          >
            31
          </text>
        </svg>
      );
    case "drive":
      return (
        <svg {...svgProps}>
          <path
            d="M8.1 3.5h4.65l8.45 14.65h-4.65L8.1 3.5Z"
            fill={GOOGLE_MARK_COLORS.yellow}
          />
          <path
            d="M8.1 3.5 3.2 12l4.65 8.05 4.9-8.5L8.1 3.5Z"
            fill={GOOGLE_MARK_COLORS.green}
          />
          <path
            d="M3.2 12h9.55l3.8 6.15H6.75L3.2 12Z"
            fill={GOOGLE_MARK_COLORS.blue}
          />
        </svg>
      );
    case "docs":
      return (
        <svg {...svgProps}>
          <path
            d="M6 2.5h8l4 4v15H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z"
            fill={GOOGLE_MARK_COLORS.blue}
          />
          <path d="M14 2.5v4h4" fill={GOOGLE_MARK_COLORS.blueLight} />
          <path
            d="M8 11h8M8 14.5h8M8 18h5"
            stroke="white"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "sheets":
      return (
        <svg {...svgProps}>
          <path
            d="M6 2.5h8l4 4v15H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z"
            fill={GOOGLE_MARK_COLORS.green}
          />
          <path d="M14 2.5v4h4" fill={GOOGLE_MARK_COLORS.greenDark} />
          <path
            d="M8 10h8v8H8v-8Zm0 2.7h8M8 15.3h8M10.7 10v8"
            stroke="white"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "slides":
      return (
        <svg {...svgProps}>
          <path
            d="M6 2.5h8l4 4v15H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z"
            fill={GOOGLE_MARK_COLORS.yellowDark}
          />
          <path d="M14 2.5v4h4" fill={GOOGLE_MARK_COLORS.yellow} />
          <path
            d="M8 17V11m3 6v-3m3 3v-7"
            stroke="white"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}
