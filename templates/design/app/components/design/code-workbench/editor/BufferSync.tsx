import { useActionQuery } from "@agent-native/core/client";
import { useEffect, useRef } from "react";

import { useWorkbench } from "../store";
import { providerKindFromKey, workbenchUri } from "../workspace/types";

/**
 * Keeps open workbench tabs in sync with out-of-band edits.
 *
 * - Inline (designfs) tabs sync via `read-source-file`, using the shared
 *   query cache's normal refetch behavior (agent/canvas edits invalidate
 *   the query).
 * - Localhost tabs have no shared query cache to invalidate from (the file
 *   lives on the user's disk, edited by their own editor or the agent
 *   through the bridge) so they are synced by polling `provider.readFile`
 *   on an interval instead.
 *
 * Both paths funnel through `api.applyExternalRead`, which is a no-op when
 * the versionHash is unchanged and flags a conflict instead of clobbering
 * unsaved local edits.
 *
 * Renders nothing — this is purely a data-sync component mounted once per
 * workbench.
 */
export function BufferSyncGroup({ designId }: { designId: string }) {
  const { state } = useWorkbench();
  const inlineTabs = state.tabs.filter(
    (tab) => providerKindFromKey(tab.providerKey) === "inline",
  );
  const localhostTabs = state.tabs.filter(
    (tab) => providerKindFromKey(tab.providerKey) === "localhost",
  );
  return (
    <>
      {inlineTabs.map((tab) => (
        <BufferSyncOne key={tab.uri} designId={designId} path={tab.path} />
      ))}
      {localhostTabs.map((tab) => (
        <LocalhostBufferSyncOne
          key={tab.uri}
          providerKey={tab.providerKey}
          path={tab.path}
        />
      ))}
    </>
  );
}

function BufferSyncOne({ designId, path }: { designId: string; path: string }) {
  const { state, api } = useWorkbench();
  const uri = workbenchUri(`inline:${designId}`, path);
  const { data } = useActionQuery("read-source-file", { designId, path });
  const read = data as
    | {
        content: string;
        versionHash?: string;
        readonly?: boolean;
        language?: string;
        fileId?: string;
      }
    | undefined;
  const buffer = state.buffers[uri];
  const versionHash = read?.versionHash;
  const savedVersionHash = buffer?.savedVersionHash;
  useEffect(() => {
    if (!read || !buffer) return;
    if (versionHash === savedVersionHash) return;
    api.applyExternalRead(uri, read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, versionHash, savedVersionHash, Boolean(buffer)]);
  return null;
}

const LOCALHOST_POLL_INTERVAL_MS = 5000;

/**
 * Polls a single open localhost tab's file for external changes (edits made
 * directly on disk, or by the agent through the bridge outside this
 * workbench session). Skips polling while the tab/document is hidden, clears
 * its interval on unmount, and swallows read errors silently — the bridge
 * may be temporarily unreachable (dev server restarting, bridge stopped),
 * which should not surface as a workbench error.
 */
function LocalhostBufferSyncOne({
  providerKey,
  path,
}: {
  providerKey: string;
  path: string;
}) {
  const { state, api } = useWorkbench();
  const uri = workbenchUri(providerKey, path);
  const buffer = state.buffers[uri];
  const savedVersionHash = buffer?.savedVersionHash;
  // Keep the latest values in refs so the interval callback always sees
  // current state without needing to be re-created every render.
  const savedVersionHashRef = useRef(savedVersionHash);
  savedVersionHashRef.current = savedVersionHash;

  useEffect(() => {
    if (!buffer) return;
    const provider = api.getProvider(providerKey);
    if (!provider) return;

    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const read = await provider.readFile(path);
        if (cancelled) return;
        if (read.versionHash === savedVersionHashRef.current) return;
        api.applyExternalRead(uri, read);
      } catch {
        // Bridge may be down or the connection may have dropped — ignore and
        // retry on the next tick.
      }
    };

    const interval = setInterval(poll, LOCALHOST_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, providerKey, path, Boolean(buffer)]);

  return null;
}
