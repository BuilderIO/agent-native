import { IconArrowLeft, IconMicrophone2 } from "@tabler/icons-react";

export function MicOffConfirmation({
  onBack,
  onUnmute,
  onContinue,
}: {
  onBack: () => void;
  onUnmute: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="mic-off-confirmation" aria-labelledby="mic-off-title">
      <header className="mic-off-confirmation-header">
        <button
          type="button"
          className="mic-off-confirmation-back"
          onClick={onBack}
        >
          <IconArrowLeft size={18} aria-hidden="true" />
          Back
        </button>
      </header>

      <div className="mic-off-confirmation-body">
        <div className="mic-off-confirmation-visual" aria-hidden="true">
          <IconMicrophone2 size={42} strokeWidth={1.7} />
          <span className="mic-off-confirmation-slash" />
        </div>
        <h2 id="mic-off-title">Your mic is muted</h2>
        <p>
          To have sound in your video, you&apos;ll need to unmute your
          microphone.
        </p>
      </div>

      <footer className="mic-off-confirmation-actions">
        <button type="button" className="secondary" onClick={onUnmute}>
          Unmute
        </button>
        <button type="button" className="primary" onClick={onContinue}>
          Continue
        </button>
      </footer>
    </section>
  );
}
