import { createContext, useContext } from "react";

/** Replaces mention tokens in respondent-facing text with live values. */
export const MentionValuesContext = createContext<(text: string) => string>(
  (text) => text,
);

export const useResolveMentions = () => useContext(MentionValuesContext);
