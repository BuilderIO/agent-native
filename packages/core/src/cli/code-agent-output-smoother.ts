import {
  smoothStreamingPunctuationDelayMs,
  smoothStreamingRevealCount,
  splitStreamingTextGraphemes,
} from "../shared/streaming-text-smoothing.js";

export interface CodeAgentOutputSmoother {
  write(delta: string): void;
  flush(): Promise<void>;
  cancel(): void;
}

const FRAME_DELAY_MS = 16;
const FLUSH_DEADLINE_MS = 700;

export function createCodeAgentOutputSmoother(
  output: NodeJS.WritableStream | undefined,
): CodeAgentOutputSmoother {
  if (!output || !shouldSmoothOutput(output)) {
    return {
      write(delta) {
        output?.write(delta);
      },
      async flush() {},
      cancel() {},
    };
  }

  return new TerminalCodeAgentOutputSmoother(output);
}

function shouldSmoothOutput(output: NodeJS.WritableStream): boolean {
  if (process.env.AGENT_NATIVE_SMOOTH_STREAM === "0") return false;
  if (process.env.CI) return false;
  return Boolean((output as NodeJS.WriteStream).isTTY);
}

class TerminalCodeAgentOutputSmoother implements CodeAgentOutputSmoother {
  private target = "";
  private graphemes: string[] = [];
  private visibleCount = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastFrameAt = Date.now();
  private flushDeadline: number | null = null;
  private flushResolvers: Array<() => void> = [];

  constructor(private readonly output: NodeJS.WritableStream) {}

  write(delta: string): void {
    if (!delta) return;
    this.target += delta;
    this.graphemes = splitStreamingTextGraphemes(this.target);
    this.schedule(0);
  }

  flush(): Promise<void> {
    if (this.visibleCount >= this.graphemes.length) {
      return Promise.resolve();
    }

    this.flushDeadline = Date.now() + FLUSH_DEADLINE_MS;
    this.schedule(0);
    return new Promise((resolve) => {
      this.flushResolvers.push(resolve);
    });
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.resolveFlushes();
  }

  private schedule(delayMs: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.step();
    }, delayMs);
  }

  private step(): void {
    const backlog = this.graphemes.length - this.visibleCount;
    if (backlog <= 0) {
      this.flushDeadline = null;
      this.resolveFlushes();
      return;
    }

    const now = Date.now();
    const forceFlush = this.flushDeadline != null && now >= this.flushDeadline;
    const elapsedMs = Math.min(
      120,
      Math.max(FRAME_DELAY_MS, now - this.lastFrameAt),
    );
    this.lastFrameAt = now;
    const revealCount = forceFlush
      ? backlog
      : smoothStreamingRevealCount({
          backlog,
          elapsedMs,
          inputDone: this.flushDeadline != null,
        });

    if (revealCount > 0) {
      const nextCount = Math.min(
        this.graphemes.length,
        this.visibleCount + revealCount,
      );
      const nextText = this.graphemes
        .slice(this.visibleCount, nextCount)
        .join("");
      this.visibleCount = nextCount;
      if (nextText) this.output.write(nextText);
    }

    const nextBacklog = this.graphemes.length - this.visibleCount;
    if (nextBacklog <= 0) {
      this.flushDeadline = null;
      this.resolveFlushes();
      return;
    }

    const pauseMs =
      this.flushDeadline == null
        ? smoothStreamingPunctuationDelayMs(
            this.graphemes[this.visibleCount - 1],
            nextBacklog,
          )
        : 0;
    this.schedule(Math.max(FRAME_DELAY_MS, pauseMs));
  }

  private resolveFlushes(): void {
    const resolvers = this.flushResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}
