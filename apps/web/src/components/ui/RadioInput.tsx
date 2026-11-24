import { useId, type InputHTMLAttributes } from "react";

export interface RadioInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
}

/** One choice of a group that shares a `name`; only one of them is selected at a time. */
export function RadioInput({ label, hint, id, ...rest }: RadioInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="flex items-center gap-2 text-sm text-app-fg">
        <input
          id={inputId}
          type="radio"
          aria-describedby={hint ? hintId : undefined}
          className="size-4 accent-app-accent"
          {...rest}
        />
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="ml-6 text-xs text-app-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
