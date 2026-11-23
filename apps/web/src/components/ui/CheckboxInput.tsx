import { useId, type InputHTMLAttributes } from "react";

export interface CheckboxInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  hint?: string;
}

export function CheckboxInput({ label, hint, id, ...rest }: CheckboxInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="flex items-center gap-2 text-sm text-app-fg">
        <input
          id={inputId}
          type="checkbox"
          aria-describedby={hint ? hintId : undefined}
          className="size-4 accent-app-accent"
          {...rest}
        />
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-app-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
