import * as React from "react";

type DataAttributes = Record<`data-${string}`, string | undefined>;

export interface AuthFormField {
  id: string;
  label: React.ReactNode;
  labelProps?: React.LabelHTMLAttributes<HTMLLabelElement> & DataAttributes;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & DataAttributes;
}

export interface AuthFormProps {
  id: string;
  fields: readonly AuthFormField[];
  submitLabel: React.ReactNode;
  className?: string;
  submitProps?: React.ButtonHTMLAttributes<HTMLButtonElement> & DataAttributes;
  footer?: React.ReactNode;
  messageId?: string;
  messageClassName?: string;
}

/** Server-renderable form markup for the built-in sign-in and signup flows. */
export function AuthForm({
  id,
  fields,
  submitLabel,
  className,
  submitProps,
  footer,
  messageId,
  messageClassName = "msg",
}: AuthFormProps) {
  const {
    children: _children,
    className: submitClassName,
    type: _type,
    ...buttonProps
  } = submitProps ?? {};

  return (
    <form id={id} className={className ? `form ${className}` : "form"}>
      {fields.map((field) => (
        <React.Fragment key={field.id}>
          <label {...field.labelProps} htmlFor={field.id}>
            {field.label}
          </label>
          <input {...field.inputProps} id={field.id} />
        </React.Fragment>
      ))}
      <button {...buttonProps} type="submit" className={submitClassName}>
        {submitLabel}
      </button>
      {footer}
      {messageId ? <p className={messageClassName} id={messageId} /> : null}
    </form>
  );
}
