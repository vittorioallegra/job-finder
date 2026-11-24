import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { PROFILE_LIMITS } from "@job-finder/bridge";

export interface ChipsInputProps {
  /** Names the list for screen readers; the input's own label is `addLabel`. */
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  hint: string;
  emptyText: string;
  removeLabel: (value: string) => string;
  /** At most this many chips; the input is hidden once the list is full. */
  max?: number;
  /** Values offered as one-click buttons, until they are in the list. */
  suggestions?: string[];
}

/**
 * A list edited as chips: type a value and press Enter or a comma to add it, click × to remove it,
 * Backspace in the empty input removes the last one. Values are trimmed and kept once each.
 */
export function ChipsInput({
  label,
  values,
  onChange,
  addLabel,
  hint,
  emptyText,
  removeLabel,
  max,
  suggestions = [],
}: ChipsInputProps) {
  const id = useId();
  const [text, setText] = useState("");
  const full = max !== undefined && values.length >= max;

  function add(raw: string) {
    const known = new Set(values.map((value) => value.trim().toLowerCase()));
    const added: string[] = [];
    for (const part of raw.split(",")) {
      const value = part.trim().slice(0, PROFILE_LIMITS.shortText);
      if (value === "" || known.has(value.toLowerCase())) continue;
      known.add(value.toLowerCase());
      added.push(value);
    }
    const next = [...values, ...added];
    if (added.length > 0) onChange(max === undefined ? next : next.slice(0, max));
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && text === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {values.map((value, index) => (
            <li
              key={`${value}-${index}`}
              className="flex items-center gap-1 rounded-full bg-app-sunken py-1 pr-1 pl-3 text-sm text-app-fg"
            >
              {value}
              <button
                type="button"
                aria-label={removeLabel(value)}
                className="grid size-5 place-items-center rounded-full text-app-muted hover:bg-app-border hover:text-app-fg"
                onClick={() => onChange(values.filter((_, position) => position !== index))}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-app-muted">{emptyText}</p>
      )}
      {full ? null : (
        <>
          <label htmlFor={id} className="sr-only">
            {addLabel}
          </label>
          <input
            id={id}
            value={text}
            placeholder={addLabel}
            aria-describedby={`${id}-hint`}
            className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-fg shadow-card transition-colors placeholder:text-app-subtle hover:border-app-subtle focus:border-app-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-soft"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => add(text)}
          />
          <p id={`${id}-hint`} className="text-xs text-app-muted">
            {hint}
          </p>
          {suggestions.filter((value) => !values.includes(value)).length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {suggestions
                .filter((value) => !values.includes(value))
                .map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="rounded-full border border-dashed border-app-border px-3 py-1 text-xs text-app-muted hover:border-app-subtle hover:text-app-fg"
                    onClick={() => add(value)}
                  >
                    + {value}
                  </button>
                ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
