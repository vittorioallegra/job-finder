export interface ScoreRingProps {
  /** Affinity 0–100, or null when the job has not been scored. */
  score: number | null;
  /** Accessible label, e.g. "Affinity 92 out of 100". */
  label: string;
  size?: "sm" | "md";
}

/** Tone for a score: good from 80, fair from 60, weak below. */
export function scoreTone(score: number): "good" | "fair" | "weak" {
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  return "weak";
}

const TONE_VAR = { good: "var(--app-good)", fair: "var(--app-fair)", weak: "var(--app-weak)" };

/** Circular affinity score. An unscored job shows an empty ring with a dash; the label is read aloud. */
export function ScoreRing({ score, label, size = "md" }: ScoreRingProps) {
  const outer = size === "md" ? "size-14" : "size-10";
  const inner = size === "md" ? "size-11 text-[15px]" : "size-8 text-xs";
  const value = score === null ? 0 : Math.max(0, Math.min(100, Math.round(score)));
  const color = score === null ? "var(--app-border)" : TONE_VAR[scoreTone(value)];
  return (
    <div
      className={`grid flex-none place-items-center rounded-full ${outer}`}
      style={{
        background: `conic-gradient(${color} ${value}%, var(--app-sunken) 0)`,
      }}
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={`grid place-items-center rounded-full bg-app-surface font-semibold tabular-nums text-app-fg ${inner}`}
      >
        {score === null ? "–" : value}
      </span>
    </div>
  );
}
