import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDetail as ApplicationDetailRecord } from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { TextArea } from "../../components/ui/TextArea";

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
    <section
      aria-labelledby="application-detail-title"
      className="flex flex-col gap-4 rounded-lg border border-app-border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id="application-detail-title" className="text-lg font-medium text-app-fg">
          {state.status === "ready" ? state.application.jobTitle : t("applications.detail.heading")}
        </h3>
        <Button variant="secondary" onClick={onClose}>
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
          <p className="text-sm text-app-fg">{t("applications.detail.loadFailed")}</p>
          <Button
            variant="secondary"
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
          <p className="text-sm text-app-muted">
            {state.application.companyName} · {t(`applications.status.${state.application.status}`)}
          </p>
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-app-fg">{t("applications.detail.heading")}</h4>
            {state.application.events.length === 0 ? (
              <p className="text-sm text-app-muted">{t("applications.detail.noEvents")}</p>
            ) : (
              <ol className="flex flex-col gap-2 text-sm">
                {state.application.events.map((event) => (
                  <li key={event.id} className="flex flex-col gap-0.5">
                    <span className="font-medium text-app-fg">
                      {new Date(event.at).toLocaleString(i18n.language)} ·{" "}
                      {t(`applications.status.${event.status}`)}
                    </span>
                    {event.note !== null ? (
                      <span className="whitespace-pre-line text-app-muted">{event.note}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <form onSubmit={(event) => void addNote(event)} className="flex flex-col gap-2">
            <TextArea
              label={t("applications.detail.noteLabel")}
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
            />
            <div>
              <Button type="submit" variant="secondary" disabled={note.trim() === ""}>
                {t("applications.detail.addNote")}
              </Button>
            </div>
          </form>
          {noteFailed ? (
            <p role="alert" className="text-sm text-app-fg">
              {t("applications.detail.noteFailed")}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
