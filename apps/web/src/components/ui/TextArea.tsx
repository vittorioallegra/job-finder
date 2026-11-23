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
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-app-fg">
        {label}
      </label>
      <textarea
        id={inputId}
        aria-describedby={hint ? hintId : undefined}
        rows={3}
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
