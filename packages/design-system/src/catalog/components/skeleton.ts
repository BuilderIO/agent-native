export const skeletonProps = {
  loading: {
    type: "boolean",
    default: true,
    description:
      "While false, renders its children in place of the skeleton, as Radix Themes does.",
  },
} as const;
