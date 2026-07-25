import { useId, type InputHTMLAttributes } from "react";
import { fieldClasses, FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES } from "./fieldStyles";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label?: string;
  readonly error?: string;
}

export function Input({ label, error, id, className = "", ...rest }: InputProps): JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className={FIELD_LABEL_CLASSES}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={fieldClasses(Boolean(error), className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        {...rest}
      />
      {error && (
        <p id={errorId} className={FIELD_ERROR_CLASSES}>
          {error}
        </p>
      )}
    </div>
  );
}
