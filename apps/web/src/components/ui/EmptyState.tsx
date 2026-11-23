import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  /** Use "alert" for error states so screen readers announce them. */
  role?: "status" | "alert";
}

/** Centered message for empty, loading-failed or not-configured states. */
export function EmptyState({ icon, title, body, action, role }: EmptyStateProps) {
  return (
    <div
      role={role}
      className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-app-border px-6 py-12 text-center"
    >
      {icon ? (
        <div className="grid size-12 place-items-center rounded-full bg-app-sunken text-app-muted">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-xl font-semibold text-app-fg">{title}</p>
      {body ? <p className="max-w-md text-app-muted">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
