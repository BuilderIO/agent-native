import { type ConfigPlugin, withGradleProperties } from "expo/config-plugins";

const PROPERTIES: { key: string; value: string }[] = [
  { key: "org.gradle.caching", value: "true" },
];

const withCustomGradleProperties: ConfigPlugin = (config) =>
  withGradleProperties(config, (gradleConfig) => {
    for (const { key, value } of PROPERTIES) {
      const existing = gradleConfig.modResults.find(
        (item): item is { type: "property"; key: string; value: string } =>
          item.type === "property" && item.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        gradleConfig.modResults.push({ type: "property", key, value });
      }
    }
    return gradleConfig;
  });

export default withCustomGradleProperties;
