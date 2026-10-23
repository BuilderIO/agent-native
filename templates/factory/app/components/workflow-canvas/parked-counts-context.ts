import { createContext } from "react";

/** Items waiting at each Wait step, by node id. */
export type ParkedCounts = ReadonlyMap<string, number>;

/** Null until a read has succeeded, so a canvas with no provider shows no waiting badges. */
export const ParkedCountsContext = createContext<ParkedCounts | null>(null);
