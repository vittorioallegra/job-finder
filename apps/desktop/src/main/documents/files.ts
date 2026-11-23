import { join } from "node:path";
import type { DocumentKind } from "@job-finder/core/documents/schema";

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Where an application's exported PDF lives: `<root>/<application id>/<kind>.pdf`. The id is
 * checked first, so a request id can never name a path outside the root.
 */
export function documentFilePath(root: string, applicationId: string, kind: DocumentKind): string {
  if (!SAFE_ID.test(applicationId)) {
    throw new Error("invalid application id");
  }
  return join(root, applicationId, `${kind}.pdf`);
}
