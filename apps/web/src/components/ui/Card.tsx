import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "li";
  padded?: boolean;
}

/** Raised surface for grouped content: a job, a settings section, a summary. */
export function Card({ as: Tag = "div", padded = true, className = "", ...rest }: CardProps) {
  return (
    <Tag
      className={`rounded-2xl border border-app-border bg-app-surface shadow-card ${padded ? "p-5" : ""} ${className}`}
      {...rest}
    />
  );
}

export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: 2 | 3;
}

/** Section title inside a card: sans-serif, so it does not compete with the page title. */
export function CardTitle({ level = 2, className = "", ...rest }: CardTitleProps) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag
      className={`font-sans text-base font-semibold tracking-normal text-app-fg ${className}`}
      {...rest}
    />
  );
}
