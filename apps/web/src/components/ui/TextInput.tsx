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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-app-fg">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={hint ? hintId : undefined}
        className={`rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-fg shadow-card transition-colors placeholder:text-app-subtle hover:border-app-subtle focus:border-app-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-soft disabled:opacity-60 ${className}`}
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
