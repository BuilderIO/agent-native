import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Draggable, circular camera bubble. Grabs its own webcam stream so the
 * popover doesn't have to pipe video frames across Tauri windows. The popover
 * emits `clips:bubble-config` with the chosen deviceId.
 */
export function Bubble() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    listen<{ deviceId?: string }>("clips:bubble-config", (ev) => {
      if (ev.payload.deviceId) setDeviceId(ev.payload.deviceId);
    }).then((u) => unlistens.push(u));
    return () => unlistens.forEach((u) => u());
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Camera unavailable");
      }
    }
    start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  return (
    <div className="bubble-root" data-tauri-drag-region>
      {error ? (
        <div className="bubble-error">{error}</div>
      ) : (
        <video
          ref={videoRef}
          className="bubble-video"
          playsInline
          muted
          autoPlay
        />
      )}
    </div>
  );
}
