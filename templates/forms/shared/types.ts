// ---------------------------------------------------------------------------
// Form field types
// ---------------------------------------------------------------------------

export type FormFieldType =
  | "text"
  | "email"
  | "number"
  | "textarea"
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "date"
  | "rating"
  | "scale";

export interface ConditionalRule {
  fieldId: string;
  operator: "equals" | "not_equals" | "contains";
  value: string;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  description?: string;
  required: boolean;
  options?: string[];
  validation?: FieldValidation;
  conditional?: ConditionalRule;
  width?: "full" | "half";
}

// ---------------------------------------------------------------------------
// Form settings
// ---------------------------------------------------------------------------

export interface FormSettings {
  primaryColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  submitText?: string;
  successMessage?: string;
  redirectUrl?: string;
  showProgressBar?: boolean;
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface Form {
  id: string;
  title: string;
  description?: string;
  slug: string;
  fields: FormField[];
  settings: FormSettings;
  status: "draft" | "published" | "closed";
  responseCount?: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Form response
// ---------------------------------------------------------------------------

export interface FormResponse {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  submittedAt: string;
}
