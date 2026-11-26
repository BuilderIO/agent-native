import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const isTextStyleName = (value: string) => /^[a-z]+(?:-[a-z]+)*$/.test(value);

const twMerge = extendTailwindMerge<"text-style">({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] },
      ],
      "text-style": [{ type: [isTextStyleName] }],
    },
  },
});

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { cn };
