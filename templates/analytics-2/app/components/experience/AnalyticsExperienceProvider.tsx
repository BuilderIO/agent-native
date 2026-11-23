import { useExperienceProfile } from "@agent-native/core/client/experience-profiles";
import { useT } from "@agent-native/core/client/i18n";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";

const AnalyticsExperienceContext = createContext<ReturnType<
  typeof useExperienceProfile
> | null>(null);
export const useAnalyticsExperience = () =>
  useContext(AnalyticsExperienceContext);

export function AnalyticsExperienceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const experience = useExperienceProfile();
  const t = useT();
  const [shown, setShown] = useState(false);
  const native =
    experience.data?.values["analytics-2.native-workspace"] === true;
  useEffect(() => {
    if (!experience.data) return;
    const root = document.documentElement;
    root.dataset.experienceProfile = experience.data.profile;
    if (native) root.dataset.analyticsNative = "true";
    else delete root.dataset.analyticsNative;
    root.dataset.themeFamily = native ? "agent-native" : "original";
    if (native) delete root.dataset.visualTheme;
    else root.dataset.visualTheme = "reference";
    setShown(true);
    return () => {
      delete root.dataset.experienceProfile;
      delete root.dataset.analyticsNative;
    };
  }, [experience.data, native]);
  return (
    <AnalyticsExperienceContext.Provider value={experience}>
      {!shown ? <Skeleton className="fixed inset-0" /> : null}
      {experience.isError ? (
        <div
          role="alert"
          className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-sm"
        >
          {t("experience.switchFailed")}
          <Button onClick={() => void experience.refetch()}>
            {t("experience.retry")}
          </Button>
        </div>
      ) : null}
      <div className={shown ? "contents" : "hidden"}>{children}</div>
    </AnalyticsExperienceContext.Provider>
  );
}
