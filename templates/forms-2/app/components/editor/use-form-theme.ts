import { useActionMutation } from "@agent-native/core/client/hooks";
import type { FormDetail, FormSettings } from "@shared/form-contract";
import { customCssSchema, type FormTheme } from "@shared/theme/form-theme";
import { useCallback, useEffect, useRef, useState } from "react";

const SAVE_DELAY_MS = 600;

type Patch = { theme?: FormTheme; customCss?: string };

/**
 * Theme and custom CSS save immediately through `update-form-settings`; unlike
 * blocks they have no draft, so a change is live on the public form at once.
 */
export function useFormTheme(form: FormDetail) {
  const [theme, setTheme] = useState<FormTheme | undefined>(
    form.settings.theme,
  );
  const [customCss, setCustomCss] = useState(form.settings.customCss ?? "");
  const save = useActionMutation("update-form-settings");
  const saveRef = useRef(save.mutate);
  saveRef.current = save.mutate;
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formId = form.id;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const settings = pending.current;
    if (!settings.theme && settings.customCss === undefined) return;
    pending.current = {};
    saveRef.current({ id: formId, settings });
  }, [formId]);

  const queue = useCallback(
    (patch: Patch) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const changeTheme = useCallback(
    (next: FormTheme) => {
      setTheme(next);
      queue({ theme: next });
    },
    [queue],
  );

  const changeCss = useCallback(
    (next: string) => {
      setCustomCss(next);
      if (customCssSchema.safeParse(next).success) queue({ customCss: next });
    },
    [queue],
  );

  const settings: FormSettings = { ...form.settings, customCss };
  if (theme) settings.theme = theme;
  return {
    theme,
    customCss,
    cssTooLarge: !customCssSchema.safeParse(customCss).success,
    settings,
    changeTheme,
    changeCss,
  };
}
