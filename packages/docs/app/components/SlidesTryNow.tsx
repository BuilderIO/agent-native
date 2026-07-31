import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef, useState } from "react";

type DeckKind = "pitch" | "sales" | "talk" | "other";

const DECK_OPTIONS: { id: DeckKind; labelKey: string; deckKey?: string }[] = [
  { id: "pitch", labelKey: "q1Pitch", deckKey: "deckPitch" },
  { id: "sales", labelKey: "q1Sales", deckKey: "deckSales" },
  { id: "talk", labelKey: "q1Talk", deckKey: "deckTalk" },
  { id: "other", labelKey: "q1Other" },
];

const SUBJECT_QUESTION_KEY: Record<DeckKind, string> = {
  pitch: "q2Pitch",
  sales: "q2Sales",
  talk: "q2Talk",
  other: "q2Other",
};

const VIBE_KEYS = [
  "q3VibeMinimal",
  "q3VibeBold",
  "q3VibeWarm",
  "q3VibeTechnical",
];

function chipClass(selected: boolean) {
  return [
    "rounded-full border px-4 py-2 text-sm transition",
    selected
      ? "border-[var(--docs-accent)] bg-[var(--docs-accent)] text-white"
      : "border-[var(--docs-border)] bg-[var(--bg)] text-[var(--fg)] hover:border-[var(--fg-secondary)]",
  ].join(" ");
}

const inputClass =
  "w-full rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] px-4 py-2.5 text-sm text-[var(--fg)] outline-none transition placeholder:text-[var(--fg-secondary)] focus:border-[var(--docs-accent)]";

export function SlidesTryNow() {
  const t = useT();
  const tn = (key: string, options?: Record<string, unknown>) =>
    t(`templateLanding.slides.tryNow.${key}`, options);

  const [deckKind, setDeckKind] = useState<DeckKind | null>(null);
  const [deckOther, setDeckOther] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectAnswer, setSubjectAnswer] = useState("");
  const [styleInput, setStyleInput] = useState("");
  const [styleAnswer, setStyleAnswer] = useState("");
  const [styleVibe, setStyleVibe] = useState("");
  const [showVibes, setShowVibes] = useState(false);

  const deckLabel =
    deckKind === "other"
      ? deckOther.trim()
      : deckKind
        ? tn(DECK_OPTIONS.find((o) => o.id === deckKind)!.deckKey!)
        : "";
  const styleValue = styleVibe || styleAnswer;
  const ready = Boolean(deckLabel && subjectAnswer && styleValue);

  const segments: string[] = [];
  if (deckLabel) segments.push(tn("promptDeck", { deck: deckLabel }));
  if (subjectAnswer)
    segments.push(tn("promptSubject", { subject: subjectAnswer }));
  if (styleValue) {
    segments.push(
      styleVibe
        ? tn("promptStyleVibe", { style: styleVibe })
        : tn("promptStyleSite", { style: styleValue }),
    );
  }
  if (ready) segments.push(tn("promptClose"));
  const target = segments.join("\n\n");

  const [text, setText] = useState("");
  const textRef = useRef("");
  textRef.current = text;

  useEffect(() => {
    if (!target) return;
    const from = target.startsWith(textRef.current)
      ? textRef.current.length
      : 0;
    if (from === target.length) return;
    let cursor = from;
    if (from === 0) setText("");
    const id = setInterval(() => {
      cursor = Math.min(target.length, cursor + 3);
      setText(target.slice(0, cursor));
      if (cursor >= target.length) clearInterval(id);
    }, 12);
    return () => clearInterval(id);
  }, [target]);

  const answeredCount = [deckLabel, subjectAnswer, styleValue].filter(
    Boolean,
  ).length;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 text-left lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
        <div className="mb-4 text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
          {tn("step", { current: Math.min(answeredCount + 1, 3), total: 3 })}
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-sm font-semibold">{tn("q1")}</h3>
            <div className="flex flex-wrap gap-2">
              {DECK_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDeckKind(option.id)}
                  className={chipClass(deckKind === option.id)}
                >
                  {tn(option.labelKey)}
                </button>
              ))}
            </div>
            {deckKind === "other" && (
              <input
                autoFocus
                value={deckOther}
                onChange={(e) => setDeckOther(e.target.value)}
                placeholder={tn("q1OtherPlaceholder")}
                className={`mt-3 ${inputClass}`}
              />
            )}
          </div>

          {deckKind && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">
                {tn(SUBJECT_QUESTION_KEY[deckKind])}
              </h3>
              <p className="mb-3 mt-0 text-sm text-[var(--fg-secondary)]">
                {tn("q2Detail")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSubjectAnswer(subject.trim());
                  }}
                  placeholder={tn("q2Placeholder")}
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={!subject.trim()}
                  onClick={() => setSubjectAnswer(subject.trim())}
                  className="shrink-0 rounded-lg border border-[var(--docs-border)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--fg-secondary)] disabled:opacity-40"
                >
                  {tn("answerAction")}
                </button>
              </div>
            </div>
          )}

          {subjectAnswer && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">{tn("q3")}</h3>
              <p className="mb-3 mt-0 text-sm text-[var(--fg-secondary)]">
                {tn("q3Detail")}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={styleInput}
                  onChange={(e) => setStyleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    setStyleAnswer(styleInput.trim());
                    setStyleVibe("");
                  }}
                  placeholder={tn("q3Placeholder")}
                  className={inputClass}
                />
                <button
                  type="button"
                  disabled={!styleInput.trim()}
                  onClick={() => {
                    setStyleAnswer(styleInput.trim());
                    setStyleVibe("");
                  }}
                  className="shrink-0 rounded-lg border border-[var(--docs-border)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--fg-secondary)] disabled:opacity-40"
                >
                  {tn("answerAction")}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowVibes((v) => !v)}
                className="mt-3 text-sm text-[var(--docs-accent)] underline-offset-2 hover:underline"
              >
                {tn("q3VibeToggle")}
              </button>
              {showVibes && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {VIBE_KEYS.map((key) => {
                    const label = tn(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setStyleVibe(label);
                          setStyleAnswer("");
                          setStyleInput("");
                        }}
                        className={chipClass(styleVibe === label)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--docs-border)] bg-[var(--bg-secondary)] p-6">
        <label
          htmlFor="slides-try-now-prompt"
          className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]"
        >
          {tn("composerLabel")}
        </label>
        <textarea
          id="slides-try-now-prompt"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tn("composerPlaceholder")}
          rows={9}
          className="w-full flex-1 resize-none rounded-lg border border-[var(--docs-border)] bg-[var(--bg)] p-4 text-sm leading-6 text-[var(--fg)] outline-none transition placeholder:text-[var(--fg-secondary)] focus:border-[var(--docs-accent)]"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-[var(--fg-secondary)]">
            {ready ? tn("readyHint") : ""}
          </span>
          <span className="relative inline-flex">
            {ready && (
              <span className="pointer-events-none absolute -inset-1 animate-pulse rounded-xl ring-2 ring-[var(--docs-accent)]" />
            )}
            <button
              type="button"
              disabled={!text.trim()}
              className="relative inline-flex items-center gap-2 rounded-xl bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              {tn("submit")}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
