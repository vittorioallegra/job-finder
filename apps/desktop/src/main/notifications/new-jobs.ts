import type { OpenNewJobsRequest } from "@job-finder/bridge";
import type { Translate } from "../i18n";
import type { NewJobMatches } from "../scheduler/matches";

export interface NotificationText {
  title: string;
  body: string;
}

/** Title and body of the notification for a run with new matches, in the app's language. */
export function newJobsText(t: Translate, matches: NewJobMatches): NotificationText {
  const plural = matches.count === 1 ? "one" : "other";
  let body = t(`notifications.newJobs.${plural}`, { count: matches.count });
  if (matches.topScore !== null) {
    body += t("notifications.topMatch", { score: matches.topScore });
  }
  return { title: t("notifications.newJobsTitle"), body };
}

/** The operating system's notification, behind an interface so the policy is testable. */
export interface NotificationSink {
  isSupported(): boolean;
  /** Shows the notification; `onClick` runs when the user clicks it. */
  show(text: NotificationText, onClick: () => void): void;
}

/**
 * Shows one notification for a run with new matches, when the platform supports them. A click
 * hands the request to `open`, which shows the window with the new jobs.
 */
export function createNewJobsNotifier(options: {
  translate: Translate;
  sink: NotificationSink;
  open: (request: OpenNewJobsRequest) => void;
}): (matches: NewJobMatches) => void {
  return (matches) => {
    if (!options.sink.isSupported()) return;
    options.sink.show(newJobsText(options.translate, matches), () => options.open({}));
  };
}
