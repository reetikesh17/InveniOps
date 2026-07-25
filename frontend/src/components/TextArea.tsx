import { useId, type TextareaHTMLAttributes } from "react";
import { fieldClasses, FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES } from "./fieldStyles";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label?: string;
  readonly error?: string;
}

export function TextArea({ label, error, id, className = "", rows = 3, ...rest }: TextAreaProps): JSX.Element {
  const generatedId = useId();
  const textAreaId = id ?? generatedId;
  const errorId = error ? `${textAreaId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={textAreaId} className={FIELD_LABEL_CLASSES}>
          {label}
        </label>
      )}
      <textarea
        id={textAreaId}
        rows={rows}
        className={fieldClasses(Boolean(error), `resize-y ${className}`)}
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
