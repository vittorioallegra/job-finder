import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SavedSearch } from "@job-finder/bridge";
import { Button } from "../../components/ui/Button";
import { TextInput } from "../../components/ui/TextInput";

export type SavedSearchesState =
  { status: "loading" } | { status: "error" } | { status: "ready"; searches: SavedSearch[] };

interface SavedSearchesProps {
  state: SavedSearchesState;
  /** The filter the results currently show, which a new or replaced search stores. */
  saveable: boolean;
  onApply: (search: SavedSearch) => void;
  onCreate: (name: string) => void;
  onReplace: (search: SavedSearch) => void;
  onDelete: (search: SavedSearch) => void;
  onRetry: () => void;
}

/** Saved searches: apply one to the form, store the current filters under a name, replace or delete. */
export function SavedSearches({
  state,
  saveable,
  onApply,
  onCreate,
  onReplace,
  onDelete,
  onRetry,
}: SavedSearchesProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");

  return (
    <section
      aria-labelledby="jobs-saved-title"
      className="flex flex-col gap-3 border-t border-app-border pt-5"
    >
      <h3 id="jobs-saved-title" className="font-sans text-base font-semibold text-app-fg">
        {t("jobs.saved.heading")}
      </h3>
      {state.status === "loading" ? (
        <p role="status" className="text-sm text-app-muted">
          {t("jobs.saved.loading")}
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-app-danger">{t("jobs.saved.loadFailed")}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t("jobs.saved.retry")}
          </Button>
        </div>
      ) : null}
      {state.status === "ready" && state.searches.length === 0 ? (
        <p className="text-sm text-app-muted">{t("jobs.saved.empty")}</p>
      ) : null}
      {state.status === "ready" && state.searches.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.searches.map((search) => (
            <li
              key={search.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-app-sunken px-3 py-2"
            >
              <span className="text-sm font-medium text-app-fg">{search.name}</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t("jobs.saved.applyNamed", { name: search.name })}
                  onClick={() => onApply(search)}
                >
                  {t("jobs.saved.apply")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!saveable}
                  aria-label={t("jobs.saved.replaceNamed", { name: search.name })}
                  onClick={() => onReplace(search)}
                >
                  {t("jobs.saved.replace")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t("jobs.saved.deleteNamed", { name: search.name })}
                  onClick={() => onDelete(search)}
                >
                  {t("jobs.saved.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed === "") return;
          onCreate(trimmed);
          setName("");
        }}
      >
        <div className="min-w-48 flex-1">
          <TextInput
            label={t("jobs.saved.name")}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={!saveable || name.trim() === ""}>
          {t("jobs.saved.save")}
        </Button>
      </form>
    </section>
  );
}
