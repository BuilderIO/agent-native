import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  EXTENSION_IFRAME_DISPLAY_SOURCES_PATH,
  extensionIframeMetaCspFromDisplaySources,
} from "@agent-native/core/extensions/html-shell";
import type { InteractiveHtmlDisplaySources } from "@shared/interactive-html";
import { useContext, useEffect, useMemo, useState } from "react";

import { InteractiveHtmlContext } from "./interactive-html-context";

function directive(csp: string, name: string): string[] {
  const value = new RegExp(`(?:^|;)\\s*${name} ([^;]*)`).exec(csp)?.[1] ?? "";
  return value.split(" ").filter(Boolean);
}

function readSources(response: unknown): InteractiveHtmlDisplaySources {
  const csp = extensionIframeMetaCspFromDisplaySources(response);
  return {
    imageSources: directive(csp, "img-src"),
    mediaSources: directive(csp, "media-src"),
  };
}

let pending: Promise<InteractiveHtmlDisplaySources> | null = null;

async function fetchSources(): Promise<InteractiveHtmlDisplaySources> {
  const response = await fetch(
    agentNativePath(EXTENSION_IFRAME_DISPLAY_SOURCES_PATH),
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readSources(await response.json());
}

function loadSources(): Promise<InteractiveHtmlDisplaySources> {
  pending ??= fetchSources().catch((error: unknown) => {
    pending = null;
    console.warn(
      "[content] interactive blocks show media from the default hosts only",
      error,
    );
    return readSources(null);
  });
  return pending;
}

export function useInteractiveHtmlDisplaySources(): InteractiveHtmlDisplaySources | null {
  const { displaySources } = useContext(InteractiveHtmlContext);
  const given = useMemo(
    () => (displaySources ? readSources(displaySources) : null),
    [displaySources],
  );
  const [sources, setSources] = useState<InteractiveHtmlDisplaySources | null>(
    null,
  );
  useEffect(() => {
    if (given) return;
    let cancelled = false;
    void loadSources().then((loaded) => {
      if (!cancelled) setSources(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [given]);
  return given ?? sources;
}
