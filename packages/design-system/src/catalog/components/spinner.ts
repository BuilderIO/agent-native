export const spinnerProps = {
  loading: {
    type: "boolean",
    default: true,
    description:
      "While false, renders its children in place of the spinner, as Radix Themes does.",
  },
} as const;
