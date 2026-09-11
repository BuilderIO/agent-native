import { useT } from "@agent-native/core/client/i18n";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface TimezoneSwitchDialogProps {
  open: boolean;
  savedTimezone: string;
  browserTimezone: string;
  isSwitching?: boolean;
  onKeep: () => void;
  onSwitch: () => void;
  onOpenChange: (open: boolean) => void;
}

export function TimezoneSwitchDialog({
  open,
  savedTimezone,
  browserTimezone,
  isSwitching = false,
  onKeep,
  onSwitch,
  onOpenChange,
}: TimezoneSwitchDialogProps) {
  const t = useT();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("calendarView.timezoneSwitchTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("calendarView.timezoneSwitchDescription", {
              savedTimezone,
              browserTimezone,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onKeep}>
            {t("calendarView.timezoneSwitchKeep", {
              timezone: savedTimezone,
            })}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isSwitching}
            onClick={(event) => {
              event.preventDefault();
              onSwitch();
            }}
          >
            {t("calendarView.timezoneSwitchSwitch", {
              timezone: browserTimezone,
            })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
