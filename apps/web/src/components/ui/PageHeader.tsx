import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons shown on the right, e.g. "Scan now". */
  actions?: ReactNode;
}

/** Top of every screen: serif title, one line of context, actions on the right. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-4xl leading-tight font-semibold text-app-fg">{title}</h1>
        {description ? <p className="mt-1.5 text-app-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
