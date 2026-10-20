export type NativeCameraState =
  | "idle"
  | "starting"
  | "active"
  | "permission-denied"
  | "unavailable"
  | "stopped";

export class NativeCameraError extends Error {
  constructor(readonly code: NativeCameraState) {
    super(code);
    this.name = "NativeCameraError";
  }
}

export class NativeLiveCameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private pending: Promise<void> | null = null;
  private generation = 0;
  private frameCallback = 0;
  private fallbackTimer = 0;
  private status: NativeCameraState = "idle";

  constructor(private readonly onFrame: () => void) {}

  state(): NativeCameraState {
    return this.status;
  }

  frame(): HTMLVideoElement {
    const video = this.video;
    if (this.status !== "active" || !video || video.readyState < 2)
      throw new NativeCameraError(
        this.status === "active" ? "unavailable" : this.status,
      );
    return video;
  }

  track(): MediaStreamTrack {
    const track = this.stream?.getVideoTracks()[0];
    if (this.status !== "active" || !track || track.readyState !== "live")
      throw new NativeCameraError(
        this.status === "active" ? "unavailable" : this.status,
      );
    return track;
  }

  async start(): Promise<void> {
    if (this.status === "active") return;
    if (this.pending) return this.pending;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.status = "unavailable";
      this.onFrame();
      throw new NativeCameraError("unavailable");
    }
    const generation = ++this.generation;
    this.status = "starting";
    this.onFrame();
    const pending = (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
      } catch (error) {
        if (generation !== this.generation)
          throw new NativeCameraError("stopped");
        this.status =
          error instanceof DOMException &&
          (error.name === "NotAllowedError" ||
            error.name === "PermissionDeniedError")
            ? "permission-denied"
            : "unavailable";
        this.onFrame();
        throw new NativeCameraError(this.status);
      }
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        throw new NativeCameraError("stopped");
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = stream;
      this.stream = stream;
      this.video = video;
      for (const track of stream.getVideoTracks())
        track.addEventListener("ended", this.onEnded, { once: true });
      try {
        await video.play();
        if (generation !== this.generation)
          throw new NativeCameraError("stopped");
        if (!video.videoWidth || !video.videoHeight)
          throw new NativeCameraError("unavailable");
        this.status = "active";
        this.onFrame();
        this.scheduleFrame(video);
      } catch (error) {
        this.stop();
        if (error instanceof NativeCameraError) throw error;
        this.status = "unavailable";
        throw new NativeCameraError("unavailable");
      }
    })();
    this.pending = pending;
    try {
      await pending;
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  stop(): void {
    if (this.status === "idle" || this.status === "stopped") return;
    ++this.generation;
    const video = this.video;
    if (video && this.frameCallback && "cancelVideoFrameCallback" in video)
      video.cancelVideoFrameCallback(this.frameCallback);
    this.frameCallback = 0;
    window.clearInterval(this.fallbackTimer);
    this.fallbackTimer = 0;
    this.video = null;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    this.stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", this.onEnded);
      track.stop();
    });
    this.stream = null;
    this.status = "stopped";
    this.onFrame();
  }

  private readonly onEnded = (): void => this.stop();

  private scheduleFrame(video: HTMLVideoElement): void {
    if (this.video !== video) return;
    if (!video.requestVideoFrameCallback) {
      this.fallbackTimer = window.setInterval(() => {
        if (this.video === video && this.status === "active") this.onFrame();
      }, 33);
      return;
    }
    this.frameCallback = video.requestVideoFrameCallback(() => {
      this.frameCallback = 0;
      if (this.video !== video || this.status !== "active") return;
      this.onFrame();
      this.scheduleFrame(video);
    });
  }
}
