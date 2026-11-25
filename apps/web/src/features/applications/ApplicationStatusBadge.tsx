import type { ApplicationStatus } from "@job-finder/bridge";
import { Badge } from "../../components/ui/Badge";
import { useApplicationGroup } from "../../lib/useApplicationGroup";

/** The chip with an application's group: "in preparation" while its documents are being written. */
export function ApplicationStatusBadge({
  status,
  applicationId,
}: {
  status: ApplicationStatus;
  applicationId: string;
}) {
  const { label } = useApplicationGroup(status, applicationId);
  return <Badge tone="accent">{label}</Badge>;
}
