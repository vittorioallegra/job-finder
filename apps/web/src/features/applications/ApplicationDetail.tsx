import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail as ApplicationDetailRecord } from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { TextArea } from "../../components/ui/TextArea";
import { ApplicationDocuments } from "./ApplicationDocuments";
import { ApplicationForm } from "./ApplicationForm";

type DetailState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; application: ApplicationDetailRecord };

interface ApplicationDetailProps {
  applicationId: string;
  /** Called after a note is added, so the list shows the application as it is now. */
  onChanged: (application: ApplicationDetailRecord) => void;
  onClose: () => void;
}

/** The timeline of one application (its status changes and notes), with a form to add a note. */
export function ApplicationDetail({ applicationId, onChanged, onClose }: ApplicationDetailProps) {
  const { t, i18n } = useTranslation();
  const bridge = useBridge();
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState("");
  const [noteFailed, setNoteFailed] = useState(false);

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

  return (
    <section aria-labelledby="application-detail-title" className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <h3
          id="application-detail-title"
          className="font-display text-3xl leading-tight font-semibold text-app-fg"
        >
          {state.status === "ready" ? state.application.jobTitle : t("applications.detail.heading")}
        </h3>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t("applications.detail.close")}
        </Button>
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
          <p className="flex flex-wrap items-center gap-2 text-app-muted">
            <span>{state.application.companyName} ·</span>
            <Badge tone="accent">{t(`applications.status.${state.application.status}`)}</Badge>
          </p>
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
          <ApplicationDocuments applicationId={state.application.id} />
          <ApplicationForm
            application={state.application}
            onChanged={(application) => {
              setState({ status: "ready", application });
              onChanged(application);
            }}
          />
          <Card as="div">
            <form onSubmit={(event) => void addNote(event)} className="flex flex-col gap-3">
              <TextArea
                label={t("applications.detail.noteLabel")}
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
        </>
      ) : null}
    </section>
  );
}
