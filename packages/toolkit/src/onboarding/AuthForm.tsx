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
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  submitProps?: React.ButtonHTMLAttributes<HTMLButtonElement> & DataAttributes;
  footer?: React.ReactNode;
  messageId?: string;
  message?: React.ReactNode;
  messageClassName?: string;
}

/** Server-renderable form markup for the built-in sign-in and signup flows. */
export function AuthForm({
  id,
  fields,
  submitLabel,
  className,
  onSubmit,
  submitProps,
  footer,
  messageId,
  message,
  messageClassName = "msg",
}: AuthFormProps) {
  const {
    children: _children,
    className: submitClassName,
    type: _type,
    ...buttonProps
  } = submitProps ?? {};

  return (
    <form
      id={id}
      className={className ? `form ${className}` : "form"}
      onSubmit={onSubmit}
    >
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
      {messageId ? (
        <p className={messageClassName} id={messageId}>
          {message}
        </p>
      ) : null}
    </form>
  );
}
