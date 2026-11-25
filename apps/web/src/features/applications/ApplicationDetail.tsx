import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ExternalLink, X } from "lucide-react";
import {
  APPLICATION_STATUSES,
  canTransition,
  isUnsent,
  type ApplicationDetail as ApplicationDetailRecord,
  type ApplicationStatus,
  type JobDetail,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Badge } from "../../components/ui/Badge";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { TextArea } from "../../components/ui/TextArea";
import { ApplicationDocuments } from "./ApplicationDocuments";
import { ApplicationForm } from "./ApplicationForm";
import { ApplicationStatusBadge } from "./ApplicationStatusBadge";
import { DeleteApplication } from "./DeleteApplication";

type DetailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; application: ApplicationDetailRecord };

interface ApplicationDetailProps {
  applicationId: string;
  /** Called after a note is added, so the list shows the application as it is now. */
  onChanged: (application: ApplicationDetailRecord) => void;
  /** Deletes an application not sent yet; the list drops it and closes the panel. */
  onDelete: (applicationId: string) => Promise<void>;
  onClose: () => void;
}

/** The timeline of one application (its status changes and notes), with a form to add a note. */
export function ApplicationDetail({
  applicationId,
  onChanged,
  onDelete,
  onClose,
}: ApplicationDetailProps) {
  const { t, i18n } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState("");
  const [noteFailed, setNoteFailed] = useState(false);
  const [moveFailed, setMoveFailed] = useState(false);
  // The posting's own text, for a reminder. Reading it is not essential: without it the panel shows
  // everything else.
  const [job, setJob] = useState<JobDetail | null>(null);
  const jobId = state.status === "ready" ? state.application.jobId : null;
  useEffect(() => {
    if (jobId === null) return;
    let active = true;
    bridge.jobs
      .detail({ jobId })
      .then((found) => {
        if (active) setJob(found);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [bridge, jobId]);

  useEffect(() => {
    let active = true;
    void bridge.applications
      .detail({ applicationId })
      .then((application) => {
        if (!active) return;
        setState(application === null ? { status: "missing" } : { status: "ready", application });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [bridge, applicationId, attempt]);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = note.trim();
    if (state.status !== "ready" || text === "") return;
    setNoteFailed(false);
    try {
      const result = await bridge.applications.update({ applicationId, note: text });
      if (!result.ok) {
        setNoteFailed(true);
        return;
      }
      setState({ status: "ready", application: result.application });
      setNote("");
      onChanged(result.application);
    } catch {
      setNoteFailed(true);
    }
  }

  /** After the application is sent, the user records what came back; before that it moves by itself. */
  const nextStatuses: ApplicationStatus[] =
    state.status === "ready" && !isUnsent(state.application.status)
      ? APPLICATION_STATUSES.filter(
          (status) => status !== "applied" && canTransition(state.application.status, status),
        )
      : [];

  async function moveTo(status: ApplicationStatus) {
    setMoveFailed(false);
    try {
      const result = await bridge.applications.update({ applicationId, status });
      if (!result.ok) {
        setMoveFailed(true);
        return;
      }
      setState({ status: "ready", application: result.application });
      onChanged(result.application);
    } catch {
      setMoveFailed(true);
    }
  }

  return (
    <section aria-labelledby="application-detail-title" className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
          {t("applications.detail.close")}
        </Button>
        {state.status === "ready" && isUnsent(state.application.status) ? (
          <DeleteApplication
            title={state.application.jobTitle}
            onDelete={() => onDelete(state.application.id)}
          />
        ) : null}
      </div>
      <div className="flex items-start justify-between gap-3">
        <h3
          id="application-detail-title"
          className="font-display text-3xl leading-tight font-semibold text-app-fg"
        >
          {state.status === "ready" ? state.application.jobTitle : t("applications.detail.heading")}
        </h3>
        {state.status === "ready" ? (
          <a
            href={state.application.jobUrl}
            target="_blank"
            rel="noreferrer"
            className={`${buttonClass("secondary", "sm")} shrink-0`}
          >
            {t("applications.detail.postingLink")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <p role="status" className="text-sm text-app-muted">
          {t("applications.detail.loading")}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-app-danger">{t("applications.detail.loadFailed")}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            {t("applications.retry")}
          </Button>
        </div>
      ) : null}
      {state.status === "missing" ? (
        <p className="text-sm text-app-muted">{t("applications.detail.loadFailed")}</p>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div className="flex flex-col gap-3">
            <p className="text-app-muted">
              {state.application.companyName}
              {job !== null
                ? ` · ${job.locations.length > 0 ? job.locations.join(" / ") : t("jobs.results.noLocation")}`
                : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ApplicationStatusBadge
                status={state.application.status}
                applicationId={state.application.id}
              />
              {job !== null && job.workMode !== "unknown" ? (
                <Badge>{t(`jobs.results.workMode.${job.workMode}`)}</Badge>
              ) : null}
            </div>
          </div>

          <p className="rounded-2xl bg-app-sunken/60 p-4 text-sm leading-relaxed whitespace-pre-line text-app-fg">
            {t(
              isUnsent(state.application.status)
                ? "applications.detail.guide.unsent"
                : "applications.detail.guide.sent",
            )}
          </p>

          {job !== null ? (
            <details className="group rounded-2xl border border-app-border bg-app-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 font-sans text-sm font-semibold text-app-fg">
                {t("applications.detail.jobDescription")}
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 text-app-muted transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="px-5 pb-4 text-sm leading-relaxed whitespace-pre-line text-app-fg">
                {job.description === "" ? t("jobs.detail.noDescription") : job.description}
              </p>
            </details>
          ) : null}

          <ApplicationDocuments applicationId={state.application.id} />
          <ApplicationForm
            application={state.application}
            onChanged={(application) => {
              setState({ status: "ready", application });
              onChanged(application);
            }}
          />
          {nextStatuses.length > 0 ? (
            <Card as="div" className="flex flex-col gap-3">
              <h4 className="font-sans text-sm font-semibold text-app-fg">
                {t("applications.detail.moveHeading")}
              </h4>
              <div className="flex flex-wrap gap-2">
                {nextStatuses.map((status) => (
                  <Button
                    key={status}
                    variant="secondary"
                    size="sm"
                    onClick={() => void moveTo(status)}
                  >
                    {t(`applications.detail.move.${status}`)}
                  </Button>
                ))}
              </div>
              {moveFailed ? (
                <p role="alert" className="text-sm text-app-danger">
                  {t("applications.detail.moveFailed")}
                </p>
              ) : null}
            </Card>
          ) : null}
          <Card as="div">
            <form onSubmit={(event) => void addNote(event)} className="flex flex-col gap-3">
              <TextArea
                label={t("applications.detail.noteLabel")}
                hint={t("applications.detail.noteHint")}
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" size="sm" disabled={note.trim() === ""}>
                  {t("applications.detail.addNote")}
                </Button>
              </div>
            </form>
          </Card>
          {noteFailed ? (
            <p role="alert" className="text-sm text-app-danger">
              {t("applications.detail.noteFailed")}
            </p>
          ) : null}
          <Card as="div" className="flex flex-col gap-3">
            <h4 className="font-sans text-sm font-semibold text-app-fg">
              {t("applications.detail.heading")}
            </h4>
            {state.application.events.length === 0 ? (
              <p className="text-sm text-app-muted">{t("applications.detail.noEvents")}</p>
            ) : (
              <ol className="flex flex-col text-sm">
                {state.application.events.map((event, index, all) => (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < all.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className="absolute top-3 bottom-0 left-[5px] w-px bg-app-border"
                      />
                    ) : null}
                    <span
                      aria-hidden="true"
                      className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-app-accent bg-app-surface"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-app-fg">
                        {new Date(event.at).toLocaleString(i18n.language)} ·{" "}
                        {t(`applications.status.${event.status}`)}
                      </span>
                      {event.note !== null ? (
                        <span className="whitespace-pre-line text-app-muted">{event.note}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      ) : null}
    </section>
  );
}
