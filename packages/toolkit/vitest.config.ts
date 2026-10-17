import baseConfig from "../../vitest.shared";

export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    setupFiles: ["./test-setup.ts"],
  },
};
