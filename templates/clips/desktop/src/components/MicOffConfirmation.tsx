import { IconArrowLeft, IconMicrophone2 } from "@tabler/icons-react";

export function MicOffConfirmation({ onBack }: { onBack: () => void }) {
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
          You can change your microphone setting and then come back to start
          recording.
        </p>
      </div>
    </section>
  );
}
