import { useT } from "@agent-native/core/client";
import { Button } from "@agent-native/toolkit/ui/button";
import { Input } from "@agent-native/toolkit/ui/input";
import { IconLock } from "@tabler/icons-react";
import { useState } from "react";

export interface AccessPasswordPromptProps {
  onSubmit: (password: string) => void;
  error?: string | null;
  title?: string;
}

export function AccessPasswordPrompt({
  onSubmit,
  error,
  title,
}: AccessPasswordPromptProps) {
  const t = useT();
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center justify-center min-h-screen p-6 bg-background">
      <div className="max-w-sm w-full rounded-2xl bg-card border border-border p-6 space-y-4 shadow-xl">
        <div className="flex items-center gap-2 text-primary">
          <IconLock className="h-5 w-5" />
          <h1 className="text-lg font-semibold">
            {title ?? t("embedRoute.passwordRequired")}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("clipsFinalRaw.passwordProtectedDescription")}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(value);
          }}
          className="space-y-3"
        >
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("clipsFinalRaw.password")}
            autoFocus
          />
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <Button
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={!value}
          >
            {t("clipsFinalRaw.unlock")}
          </Button>
        </form>
      </div>
    </div>
  );
}
