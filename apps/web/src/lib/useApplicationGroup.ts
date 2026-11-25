import { useTranslation } from "react-i18next";
import {
  groupOf,
  type DocumentKind,
  type ApplicationGroup,
  type ApplicationStatus,
} from "@job-finder/bridge";
import { useGeneration } from "./document-generation";

/**
 * The group an application is shown in. An application that is not sent yet reads "in preparation"
 * while its documents are being written, and goes back to "to send" by itself when they are done.
 * That state lives with the writing, not in the database, so it never gets stuck.
 */
export function useApplicationGroup(
  status: ApplicationStatus,
  applicationId: string | null,
): {
  group: ApplicationGroup | "preparing";
  label: string;
  /** The document being written for the application now, or null. */
  running: DocumentKind | null;
} {
  const { t } = useTranslation();
  const generation = useGeneration(applicationId ?? "");
  const stored = groupOf(status);
  const running = stored === "to-send" ? generation.running : null;
  const group = running !== null ? "preparing" : stored;
  return { group, label: t(`applications.group.${group}`), running };
}
