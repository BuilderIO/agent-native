import type { DaySchedule, TimeSlot } from "../../shared/api";

export const DEFAULT_TIME_SLOT: TimeSlot = {
  start: "09:00",
  end: "17:00",
};

export function getEditableTimeSlots(day: DaySchedule): TimeSlot[] {
  return day.slots.length > 0 ? day.slots : [{ ...DEFAULT_TIME_SLOT }];
}

export function setDayEnabled(day: DaySchedule, enabled: boolean): DaySchedule {
  return {
    ...day,
    enabled,
    slots: enabled ? getEditableTimeSlots(day) : day.slots,
  };
}

export function updateTimeSlot(
  day: DaySchedule,
  slotIndex: number,
  field: "start" | "end",
  value: string,
): DaySchedule {
  return {
    ...day,
    slots: getEditableTimeSlots(day).map((slot, index) =>
      index === slotIndex ? { ...slot, [field]: value } : slot,
    ),
  };
}

export function addTimeSlot(day: DaySchedule): DaySchedule {
  return {
    ...day,
    slots: [...getEditableTimeSlots(day), { ...DEFAULT_TIME_SLOT }],
  };
}

export function removeTimeSlot(
  day: DaySchedule,
  slotIndex: number,
): DaySchedule {
  const slots = getEditableTimeSlots(day).filter(
    (_, index) => index !== slotIndex,
  );

  return {
    ...day,
    slots: slots.length > 0 ? slots : [{ ...DEFAULT_TIME_SLOT }],
  };
}
