import { useId, type InputHTMLAttributes } from "react";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

/** Labelled text, number or password input. The hint is linked with `aria-describedby`. */
export function TextInput({ label, hint, id, className = "", ...rest }: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-app-fg">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={hint ? hintId : undefined}
        className={`rounded-md border border-app-border bg-transparent px-3 py-2 text-app-fg ${className}`}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-app-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
