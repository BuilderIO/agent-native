import type { ValidationError } from "@shared/form-model";

import type { Translate } from "@/lib/translate";

export function validationMessage(
  t: Translate,
  error: ValidationError,
): string {
  const params = { min: error.min, max: error.max };
  switch (error.code) {
    case "required":
      return t("forms.respond.validation.required");
    case "email":
      return t("forms.respond.validation.email");
    case "phone":
      return t("forms.respond.validation.phone");
    case "url":
      return t("forms.respond.validation.url");
    case "min_chars":
      return t("forms.respond.validation.minChars", params);
    case "max_chars":
      return t("forms.respond.validation.maxChars", params);
    case "min_number":
      return t("forms.respond.validation.minNumber", params);
    case "max_number":
      return t("forms.respond.validation.maxNumber", params);
    case "date_range":
      if (error.min && error.max)
        return t("forms.respond.validation.dateBetween", params);
      return error.min
        ? t("forms.respond.validation.dateOnOrAfter", params)
        : t("forms.respond.validation.dateOnOrBefore", params);
    case "min_selections":
      return t("forms.respond.validation.minSelections", params);
    case "max_selections":
      return t("forms.respond.validation.maxSelections", params);
    case "other_empty":
      return t("forms.respond.validation.otherEmpty");
    case "ranking":
      return t("forms.richBlocks.validation.ranking");
    case "matrix":
      return t("forms.richBlocks.validation.matrix");
    case "file":
      return t("forms.richBlocks.validation.file", params);
    case "signature":
      return t("forms.richBlocks.validation.signature");
    case "invalid_value":
      return t("forms.respond.validation.invalidValue");
  }
}
