import { useT } from "@agent-native/core/client/i18n";
import {
  IconFile,
  IconFileImport,
  IconLayoutBoard,
  IconSparkles,
  type Icon,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

function Row({
  icon: Glyph,
  onClick,
  children,
}: {
  icon: Icon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-2.5 rounded-md text-left text-sm leading-5 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
    >
      <Glyph aria-hidden className="size-4 shrink-0" stroke={1.6} />
      {children}
    </button>
  );
}

function Keycap({ children }: { children: string }) {
  return (
    <span className="mx-0.5 rounded-[5px] bg-primary/10 px-1.5 py-px font-semibold text-primary">
      {children}
    </span>
  );
}

/** The hint with `[/]` and `[@]` drawn as keycaps; translators keep the brackets. */
function Hint({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\[[^\]]\])/)
        .map((part, index) =>
          /^\[[^\]]\]$/.test(part) ? (
            <Keycap key={index}>{part.slice(1, -1)}</Keycap>
          ) : (
            part
          ),
        )}
    </>
  );
}

/** Shown under the form title while the form has no content. */
export function StartOptions({
  onScratch,
  onAi,
  onTemplate,
  onImport,
}: {
  onScratch: () => void;
  onAi: () => void;
  onTemplate: () => void;
  onImport: () => void;
}) {
  const t = useT();
  return (
    <div className="px-4 min-[960px]:px-[100px]">
      <div className="flex flex-col gap-1">
        <Row icon={IconFile} onClick={onScratch}>
          {t("forms.start.scratch")}
        </Row>
        <Row icon={IconSparkles} onClick={onAi}>
          {t("forms.start.createWithAi")}
        </Row>
        <Row icon={IconLayoutBoard} onClick={onTemplate}>
          {t("forms.start.useTemplate")}
        </Row>
        <Row icon={IconFileImport} onClick={onImport}>
          {t("forms.start.importForm")}
        </Row>
      </div>
      <p className="mt-9 text-base leading-6 text-foreground/90">
        {t("forms.start.hintIntro")}
        <br />
        <Hint text={t("forms.start.hintKeys")} />
      </p>
    </div>
  );
}
