import { createContext, useContext } from "react";

/** False on an embed that did not ask to track: no visit, start or page events. */
export const TrackEventsContext = createContext(true);

export const useTrackEvents = () => useContext(TrackEventsContext);
