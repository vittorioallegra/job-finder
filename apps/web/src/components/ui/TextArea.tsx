import { useId, type TextareaHTMLAttributes } from "react";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
}

/** Labelled multi-line text input. The hint is linked with `aria-describedby`. */
export function TextArea({ label, hint, id, className = "", ...rest }: TextAreaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[13px] font-medium text-app-fg">
        {label}
      </label>
      <textarea
        id={inputId}
        aria-describedby={hint ? hintId : undefined}
        rows={3}
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
