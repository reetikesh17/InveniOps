import { useId, type SelectHTMLAttributes } from "react";
import { fieldClasses, FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES } from "./fieldStyles";
import { ChevronDownIcon } from "./icons";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  readonly label?: string;
  readonly error?: string;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
}

export function Select({
  label,
  error,
  options,
  placeholder,
  id,
  className = "",
  ...rest
}: SelectProps): JSX.Element {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={selectId} className={FIELD_LABEL_CLASSES}>
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={fieldClasses(Boolean(error), `appearance-none pr-8 text-sm ${className}`)}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          defaultValue={
            rest.value === undefined && rest.defaultValue === undefined ? "" : undefined
          }
          {...rest}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
      </div>
      {error && (
        <p id={errorId} className={FIELD_ERROR_CLASSES}>
          {error}
        </p>
      )}
    </div>
  );
}
