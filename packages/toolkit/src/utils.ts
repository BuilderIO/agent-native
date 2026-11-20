import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The design system's type steps (`text-0`…`text-9`) are font sizes. Unknown
// to tailwind-merge, they would read as colors, and `cn("text-1",
// "text-fg-muted")` would drop one of the two.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] },
      ],
    },
  },
});

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { cn };
