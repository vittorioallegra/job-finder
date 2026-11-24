import { useId, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  /** Keeps the label for screen readers only, when the context already names the field. */
  hideLabel?: boolean;
}

export function SelectInput({
  label,
  options,
  hint,
  hideLabel = false,
  id,
  ...rest
}: SelectInputProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = `${selectId}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={selectId}
        className={hideLabel ? "sr-only" : "text-[13px] font-medium text-app-fg"}
      >
        {label}
      </label>
      {/* The native arrow sits against the edge; this one keeps the same inset as the text. */}
      <div className="relative">
        <select
          id={selectId}
          aria-describedby={hint ? hintId : undefined}
          className="w-full appearance-none rounded-lg border border-app-border bg-app-surface py-2 pr-10 pl-3 text-app-fg shadow-card transition-colors hover:border-app-subtle focus:border-app-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-soft disabled:opacity-60"
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-app-muted"
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-app-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
