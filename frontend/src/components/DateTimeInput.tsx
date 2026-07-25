import { useId, type InputHTMLAttributes } from "react";
import { fieldClasses, FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES } from "./fieldStyles";

export interface DateTimeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly label?: string;
  readonly error?: string;
}

/** Wraps a native datetime-local input — the RCA form's Incident Start/End pickers (docs/assignment.md). */
export function DateTimeInput({ label, error, id, className = "", ...rest }: DateTimeInputProps): JSX.Element {
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
        type="datetime-local"
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
