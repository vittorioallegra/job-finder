import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "good" | "fair" | "weak" | "danger";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-app-sunken text-app-muted",
  accent: "bg-app-accent-soft text-app-accent",
  good: "bg-app-good-soft text-app-good",
  fair: "bg-app-fair-soft text-app-fair",
  weak: "bg-app-weak-soft text-app-weak",
  danger: "bg-app-danger-soft text-app-danger",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small label for a fact about an item: work mode, seniority, status. */
export function Badge({ tone = "neutral", className = "", ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
      {...rest}
    />
  );
}
