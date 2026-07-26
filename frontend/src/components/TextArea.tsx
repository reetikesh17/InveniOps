import { useId, type ReactNode, type TextareaHTMLAttributes } from "react";
import { fieldClasses, FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES } from "./fieldStyles";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label?: string;
  readonly error?: string;
  /** Persistent helper content shown below the field (e.g. a character counter). Associated to the control via aria-describedby, alongside any error. */
  readonly hint?: ReactNode;
}

export function TextArea({ label, error, hint, id, className = "", rows = 3, ...rest }: TextAreaProps): JSX.Element {
  const generatedId = useId();
  const textAreaId = id ?? generatedId;
  const errorId = error ? `${textAreaId}-error` : undefined;
  const hintId = hint !== undefined && hint !== null ? `${textAreaId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

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
        // `prose` — this is genuinely human-authored free text (RCA
        // description, fix applied, prevention steps), the exact case the
        // type scale's prose rung names by example. The other three field
        // primitives stay at Tailwind's default text-sm; only TextArea holds
        // long-form writing.
        className={fieldClasses(Boolean(error), `resize-y font-body text-prose ${className}`)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      <div className="flex items-start justify-between gap-2">
        {error ? (
          <p id={errorId} className={FIELD_ERROR_CLASSES}>
            {error}
          </p>
        ) : (
          <span />
        )}
        {hintId && (
          <span id={hintId} className="shrink-0 text-xs">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}
