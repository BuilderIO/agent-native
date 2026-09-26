export function scheduleReadyChime(ctx: AudioContext): Promise<void> {
  return new Promise<void>((resolve) => {
    const t0 = ctx.currentTime + 0.005;
    const voices = [
      { freq: 587.33, at: 0.0, dur: 0.22, peak: 0.06 }, // D5
      { freq: 880.0, at: 0.06, dur: 0.26, peak: 0.075 }, // A5
      { freq: 1760.0, at: 0.065, dur: 0.14, peak: 0.02 }, // A6 shimmer
    ];

    let lastStop = t0;
    for (const voice of voices) {
      const startAt = t0 + voice.at;
      const stopAt = startAt + voice.dur;
      lastStop = Math.max(lastStop, stopAt);

      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(voice.freq, startAt);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(voice.peak, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start(startAt);
      oscillator.stop(stopAt + 0.02);
    }

    let resolved = false;
    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    window.setTimeout(
      finish,
      Math.ceil((lastStop - ctx.currentTime) * 1000) + 60,
    );
  });
}
