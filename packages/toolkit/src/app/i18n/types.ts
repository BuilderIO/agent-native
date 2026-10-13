import englishMessages from "./catalogs/en-US.js";

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type RequiredKey = Exclude<
  keyof typeof englishMessages,
  `${string}_${PluralSuffix}`
>;

export type ToolkitAgentChatTranslation = Record<string, string> & {
  [K in RequiredKey]: string;
};
