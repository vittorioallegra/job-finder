import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { applicationEvents, applications, companies, jobs } from "@job-finder/core";
import {
  canTransition,
  GUARD_STATUSES,
  requiredConfirmations,
  withinDuplicateWindow,
  type ApplicationStatus,
} from "@job-finder/core/applications";
import type {
  ApplicationBookmarkRequest,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationStartRequest,
  ApplicationStartResult,
  ApplicationSummary,
  ApplicationUpdateRequest,
  ApplicationUpdateResult,
  DuplicateApplication,
  DuplicateCheck,
} from "@job-finder/bridge";
import type { AppDb } from "../db/operations";

export interface ApplicationRepository {
  /** Every application, newest status change first. */
  list(): Promise<ApplicationSummary[]>;
  /** Every application with its timeline, newest status change first (for the export). */
  listDetails(): Promise<ApplicationDetail[]>;
  /** One application with its timeline, or null when it does not exist. */
  detail(applicationId: string): Promise<ApplicationDetail | null>;
  /** Bookmarks a job, or removes a bookmark. Resolves false when the job does not exist. */
  bookmark(
    request: ApplicationBookmarkRequest,
    now?: number,
    newId?: () => string,
  ): Promise<boolean>;
  /** The duplicate warning for a job. */
  check(jobId: string, now?: number): Promise<DuplicateCheck>;
  /** Starts preparing a job, refused until the confirmations the warning needs are given. */
  start(
    request: ApplicationStartRequest,
    now?: number,
    newId?: () => string,
  ): Promise<ApplicationStartResult>;
  /** A status change (only the planned ones), a note, or both. */
  update(
    request: ApplicationUpdateRequest,
    now?: number,
    newId?: () => string,
  ): Promise<ApplicationUpdateResult>;
}

const newIdDefault = () => crypto.randomUUID();

/**
 * The columns and joins every application read shares. The proxy maps rows by column name, so two
 * selected columns with the same name (`companies.id` and `applications.id`) would collide: the
 * company id is read from `jobs.company_id` instead.
 */
function selectSummaries(db: AppDb) {
  return db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      jobTitle: jobs.title,
      companyId: jobs.companyId,
      companyName: companies.name,
      status: applications.status,
      createdAt: applications.createdAt,
      statusChangedAt: applications.statusChangedAt,
      jobUrl: jobs.url,
      applyUrl: jobs.applyUrl,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id));
}

function toSummary(row: {
  id: string;
  jobId: string;
  jobTitle: string;
  companyId: string;
  companyName: string;
  status: ApplicationStatus;
  createdAt: number;
  statusChangedAt: number;
  jobUrl: string;
  applyUrl: string;
}): ApplicationSummary {
  return {
    id: row.id,
    jobId: row.jobId,
    jobTitle: row.jobTitle,
    companyId: row.companyId,
    companyName: row.companyName,
    status: row.status,
    createdAt: row.createdAt,
    statusChangedAt: row.statusChangedAt,
    jobUrl: row.jobUrl,
    applyUrl: row.applyUrl,
  };
}

function toEvent(row: {
  id: string;
  status: ApplicationStatus;
  note: string | null;
  at: number;
}): ApplicationEvent {
  return { id: row.id, status: row.status, note: row.note, at: row.at };
}

async function eventsOf(db: AppDb, applicationIds: string[]) {
  if (applicationIds.length === 0) return new Map<string, ApplicationEvent[]>();
  const rows = await db
    .select()
    .from(applicationEvents)
    .where(inArray(applicationEvents.applicationId, applicationIds))
    .orderBy(asc(applicationEvents.at), asc(applicationEvents.id));
  const byApplication = new Map<string, ApplicationEvent[]>();
  for (const row of rows) {
    const list = byApplication.get(row.applicationId) ?? [];
    list.push(toEvent(row));
    byApplication.set(row.applicationId, list);
  }
  return byApplication;
}

/**
 * Applications for one job, and for other jobs of the same company, that are past `preparing`. The
 * same job is any job with the same id or fingerprint, with no time limit. The same company counts
 * within the duplicate window only.
 */
async function findDuplicates(
  db: AppDb,
  jobId: string,
  now: number,
): Promise<DuplicateCheck | null> {
  const [job] = await db
    .select({ companyId: jobs.companyId, fingerprint: jobs.fingerprint })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;

  const rows = await db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      jobTitle: jobs.title,
      companyId: jobs.companyId,
      companyName: companies.name,
      fingerprint: jobs.fingerprint,
      status: applications.status,
      statusChangedAt: applications.statusChangedAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(
      and(
        inArray(applications.status, [...GUARD_STATUSES]),
        or(
          eq(jobs.id, jobId),
          eq(jobs.fingerprint, job.fingerprint),
          eq(jobs.companyId, job.companyId),
        ),
      ),
    )
    .orderBy(desc(applications.statusChangedAt));

  const toDuplicate = (row: (typeof rows)[number]): DuplicateApplication => ({
    id: row.id,
    jobId: row.jobId,
    jobTitle: row.jobTitle,
    companyName: row.companyName,
    status: row.status,
    statusChangedAt: row.statusChangedAt,
  });
  const sameJobRows = rows.filter(
    (row) => row.jobId === jobId || row.fingerprint === job.fingerprint,
  );
  const sameCompanyRows = rows.filter(
    (row) =>
      !sameJobRows.includes(row) &&
      row.companyId === job.companyId &&
      withinDuplicateWindow(row.statusChangedAt, now),
  );
  const sameJob = sameJobRows.map(toDuplicate);
  const sameCompany = sameCompanyRows.map(toDuplicate);
  return {
    sameJob,
    sameCompany,
    requiredConfirmations: requiredConfirmations({
      sameJob: sameJob.length,
      sameCompany: sameCompany.length,
    }),
  };
}

export function createApplicationRepository(db: AppDb): ApplicationRepository {
  async function detailOf(applicationId: string): Promise<ApplicationDetail | null> {
    const [row] = await selectSummaries(db).where(eq(applications.id, applicationId)).limit(1);
    if (!row) return null;
    const events = (await eventsOf(db, [applicationId])).get(applicationId) ?? [];
    return { ...toSummary(row), events };
  }

  /** Moves an application to `to` and records the event. The caller has checked the move. */
  async function moveTo(
    applicationId: string,
    to: ApplicationStatus,
    note: string | null,
    now: number,
    newId: () => string,
  ) {
    await db
      .update(applications)
      .set({ status: to, statusChangedAt: now })
      .where(eq(applications.id, applicationId));
    await db
      .insert(applicationEvents)
      .values({ id: newId(), applicationId, status: to, note, at: now });
  }

  /**
   * The duplicate check and the insert are several awaited statements, so two starts for one job
   * (a double click, two windows) could both see no open application. They run one at a time.
   */
  let startQueue: Promise<unknown> = Promise.resolve();

  async function startOnce(
    request: ApplicationStartRequest,
    now: number,
    newId: () => string,
  ): Promise<ApplicationStartResult> {
    const duplicates = await findDuplicates(db, request.jobId, now);
    if (duplicates === null) return { ok: false, code: "job-not-found" };
    if (duplicates.requiredConfirmations > (request.confirmations ?? 0)) {
      return { ok: false, code: "duplicate-confirmation-required", duplicates };
    }

    // The job's open application (its bookmark or its preparation) is moved on, not duplicated.
    const [open] = await db
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(
        and(
          eq(applications.jobId, request.jobId),
          inArray(applications.status, ["bookmarked", "preparing"]),
        ),
      )
      .orderBy(desc(applications.statusChangedAt))
      .limit(1);
    if (open) {
      if (open.status === "bookmarked") {
        await moveTo(open.id, "preparing", null, now, newId);
      }
      const application = await detailOf(open.id);
      return application === null
        ? { ok: false, code: "job-not-found" }
        : { ok: true, application };
    }

    const id = newId();
    await db.insert(applications).values({
      id,
      jobId: request.jobId,
      status: "preparing",
      createdAt: now,
      statusChangedAt: now,
    });
    await db
      .insert(applicationEvents)
      .values({ id: newId(), applicationId: id, status: "preparing", note: null, at: now });
    const application = await detailOf(id);
    return application === null ? { ok: false, code: "job-not-found" } : { ok: true, application };
  }

  return {
    async list() {
      const rows = await selectSummaries(db).orderBy(desc(applications.statusChangedAt));
      return rows.map(toSummary);
    },

    async listDetails() {
      const rows = await selectSummaries(db).orderBy(desc(applications.statusChangedAt));
      const events = await eventsOf(
        db,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({ ...toSummary(row), events: events.get(row.id) ?? [] }));
    },

    detail: detailOf,

    async bookmark(request, now = Date.now(), newId = newIdDefault) {
      const [job] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, request.jobId))
        .limit(1);
      if (!job) return false;

      const existing = await db
        .select({ id: applications.id, status: applications.status })
        .from(applications)
        .where(eq(applications.jobId, request.jobId));
      if (request.bookmarked) {
        // A job with any application already has its state; a second bookmark changes nothing.
        if (existing.length > 0) return true;
        const id = newId();
        await db.insert(applications).values({
          id,
          jobId: request.jobId,
          status: "bookmarked",
          createdAt: now,
          statusChangedAt: now,
        });
        await db
          .insert(applicationEvents)
          .values({ id: newId(), applicationId: id, status: "bookmarked", note: null, at: now });
        return true;
      }
      for (const bookmark of existing.filter((row) => row.status === "bookmarked")) {
        await db.delete(applicationEvents).where(eq(applicationEvents.applicationId, bookmark.id));
        await db.delete(applications).where(eq(applications.id, bookmark.id));
      }
      return true;
    },

    async check(jobId, now = Date.now()) {
      return (
        (await findDuplicates(db, jobId, now)) ?? {
          sameJob: [],
          sameCompany: [],
          requiredConfirmations: 0,
        }
      );
    },

    start(request, now = Date.now(), newId = newIdDefault) {
      const run = startQueue.then(() => startOnce(request, now, newId));
      startQueue = run.catch(() => undefined);
      return run;
    },

    async update(request, now = Date.now(), newId = newIdDefault) {
      const [current] = await db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, request.applicationId))
        .limit(1);
      if (!current) return { ok: false, code: "not-found" };

      const target = request.status;
      let next: ApplicationStatus = current.status;
      if (target !== undefined && target !== current.status) {
        if (!canTransition(current.status, target)) {
          return { ok: false, code: "invalid-transition" };
        }
        next = target;
        await db
          .update(applications)
          .set({ status: next, statusChangedAt: now })
          .where(eq(applications.id, request.applicationId));
      }
      if (next !== current.status || request.note !== undefined) {
        await db.insert(applicationEvents).values({
          id: newId(),
          applicationId: request.applicationId,
          status: next,
          note: request.note ?? null,
          at: now,
        });
      }
      const application = await detailOf(request.applicationId);
      return application === null ? { ok: false, code: "not-found" } : { ok: true, application };
    },
  };
}
