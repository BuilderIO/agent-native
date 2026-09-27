import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef } from "react";

import { useWorkbench } from "../store";
import { providerKindFromKey, workbenchUri } from "../workspace/types";

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
