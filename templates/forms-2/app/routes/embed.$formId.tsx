import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router";

import { PublicForm } from "@/components/respond/PublicForm";
import { TrackEventsContext } from "@/components/respond/track-events";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: "Form" }];
}

/** The iframe host listens for this message to resize the frame. */
const HEIGHT_MESSAGE = "forms:height";

export default function EmbedRoute() {
  const { formId = "" } = useParams();
  const [params] = useSearchParams();
  const flag = (name: string) => params.get(name) === "1";
  const dynamicHeight = flag("dynamicHeight");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!dynamicHeight || !element) return;
    const post = () =>
      window.parent.postMessage(
        {
          type: HEIGHT_MESSAGE,
          formId,
          height: Math.ceil(element.getBoundingClientRect().height),
        },
        "*",
      );
    const observer = new ResizeObserver(post);
    observer.observe(element);
    post();
    return () => observer.disconnect();
  }, [dynamicHeight, formId]);

  return (
    <TrackEventsContext.Provider value={flag("trackEvents")}>
      <div
        ref={root}
        className={cn(
          "forms-embed",
          flag("alignLeft") && "forms-embed--left",
          flag("hideTitle") && "forms-embed--hide-title",
          flag("transparentBackground") && "forms-embed--transparent",
        )}
      >
        <PublicForm formId={formId} />
      </div>
    </TrackEventsContext.Provider>
  );
}
