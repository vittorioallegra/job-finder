import { useId, type SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly SelectOption[];
  hint?: string;
}

export function SelectInput({ label, options, hint, id, ...rest }: SelectInputProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = `${selectId}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-[13px] font-medium text-app-fg">
        {label}
      </label>
      <select
        id={selectId}
        aria-describedby={hint ? hintId : undefined}
        className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-fg shadow-card transition-colors hover:border-app-subtle focus:border-app-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-soft disabled:opacity-60"
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-xs text-app-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
