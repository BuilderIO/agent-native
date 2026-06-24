import {
  SettingsPanel,
  useDevMode,
  ChangelogSettingsCard,
  LanguagePicker,
  useT,
} from "@agent-native/core/client";
import changelog from "../../CHANGELOG.md?raw";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function meta() {
  return [{ title: "Settings — Design" }];
}

export default function SettingsRoute() {
  const { isDevMode, canToggle, setDevMode } = useDevMode();
  const t = useT();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <SettingsPanel
        isDevMode={isDevMode}
        onToggleDevMode={() => setDevMode(!isDevMode)}
        showDevToggle={canToggle}
      />
      <div className="mx-auto w-full max-w-2xl px-4 pb-8">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              {t("settings.languageTitle")}
            </CardTitle>
            <CardDescription>
              {t("settings.languageDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="max-w-xs space-y-1.5">
            <Label>{t("settings.languageLabel")}</Label>
            <LanguagePicker label={t("settings.languageLabel")} />
          </CardContent>
        </Card>
        <ChangelogSettingsCard markdown={changelog} />
      </div>
    </div>
  );
}
