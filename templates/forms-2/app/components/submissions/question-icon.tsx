import type { AnswerType } from "@shared/form-model";
import {
  IconAbc,
  IconAdjustmentsHorizontal,
  IconAt,
  IconCalendar,
  IconCircleDot,
  IconClock,
  IconHash,
  IconLink,
  IconListCheck,
  IconListNumbers,
  IconPhone,
  IconSelector,
  IconSignature,
  IconSquareCheck,
  IconStar,
  IconCalculator,
  IconEyeOff,
  IconTable,
  IconTextCaption,
  IconUpload,
  type Icon,
} from "@tabler/icons-react";

const ICONS: Record<AnswerType, Icon> = {
  INPUT_TEXT: IconAbc,
  TEXTAREA: IconTextCaption,
  INPUT_EMAIL: IconAt,
  INPUT_NUMBER: IconHash,
  INPUT_PHONE_NUMBER: IconPhone,
  INPUT_LINK: IconLink,
  INPUT_DATE: IconCalendar,
  INPUT_TIME: IconClock,
  MULTIPLE_CHOICE: IconCircleDot,
  CHECKBOXES: IconSquareCheck,
  DROPDOWN: IconSelector,
  MULTI_SELECT: IconListCheck,
  RATING: IconStar,
  LINEAR_SCALE: IconAdjustmentsHorizontal,
  RANKING: IconListNumbers,
  MATRIX: IconTable,
  FILE_UPLOAD: IconUpload,
  SIGNATURE: IconSignature,
  HIDDEN_FIELD: IconEyeOff,
  CALCULATED_FIELD: IconCalculator,
};

export function QuestionIcon({ type }: { type: AnswerType }) {
  const Glyph = ICONS[type];
  return <Glyph aria-hidden className="size-3.5 shrink-0" />;
}
