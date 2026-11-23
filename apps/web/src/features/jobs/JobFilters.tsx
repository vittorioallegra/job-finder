import { useTranslation } from "react-i18next";
import type { CompanyRecord } from "@job-finder/bridge";
import { Button } from "../../components/ui/Button";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { SelectInput } from "../../components/ui/SelectInput";
import { TextInput } from "../../components/ui/TextInput";
import { SALARY_CURRENCIES, toggle, type FilterDraft } from "./filter-draft";

const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
  "temporary",
] as const;
const SENIORITIES = ["intern", "junior", "mid", "senior", "lead"] as const;
const SALARY_PERIODS = ["year", "month", "week", "day", "hour"] as const;
const POSTED_WITHIN = ["any", "24h", "3d", "7d", "30d"] as const;
const VISA = ["any", "yes", "no", "unknown"] as const;
/** The ATS ids and the generic careers page, as the sources record them. */
const SOURCES = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "personio",
  "recruitee",
  "teamtailor",
  "careers-page",
] as const;

interface JobFiltersProps {
  draft: FilterDraft;
  onChange: (draft: FilterDraft) => void;
  companies: CompanyRecord[];
  onApply: () => void;
  onReset: () => void;
  /** Set when the last apply was refused, so the form says which values to check. */
  invalid: boolean;
}

/** The filter form of the jobs screen. Values apply when the form is submitted. */
export function JobFilters({
  draft,
  onChange,
  companies,
  onApply,
  onReset,
  invalid,
}: JobFiltersProps) {
  const { t } = useTranslation();
  const set = <K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const checkboxes = <T extends string>(
    legend: string,
    values: readonly T[],
    selected: string[],
    label: (value: T) => string,
    key: keyof FilterDraft,
  ) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[13px] font-medium text-app-fg">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {values.map((value) => (
          <CheckboxInput
            key={value}
            label={label(value)}
            checked={selected.includes(value)}
            onChange={() => set(key, toggle(selected, value) as never)}
          />
        ))}
      </div>
    </fieldset>
  );

  return (
    <form
      aria-labelledby="jobs-filters-title"
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <h3 id="jobs-filters-title" className="font-sans text-base font-semibold text-app-fg">
        {t("jobs.filters.heading")}
      </h3>
      {invalid ? (
        <p role="alert" className="text-sm text-app-danger">
          {t("jobs.filters.invalid")}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextInput
          label={t("jobs.filters.keywords")}
          hint={t("jobs.filters.keywordsHint")}
          value={draft.keywords}
          onChange={(event) => set("keywords", event.target.value)}
        />
        <TextInput
          label={t("jobs.filters.excludedKeywords")}
          value={draft.excludedKeywords}
          onChange={(event) => set("excludedKeywords", event.target.value)}
        />
        <TextInput
          label={t("jobs.filters.locationText")}
          value={draft.locationText}
          onChange={(event) => set("locationText", event.target.value)}
        />
        <TextInput
          label={t("jobs.filters.countryCode")}
          hint={t("jobs.filters.countryCodeHint")}
          value={draft.countryCode}
          maxLength={2}
          onChange={(event) => set("countryCode", event.target.value)}
        />
        <TextInput
          label={t("jobs.filters.remoteScope")}
          hint={t("jobs.filters.remoteScopeHint")}
          value={draft.remoteScope}
          onChange={(event) => set("remoteScope", event.target.value)}
        />
        <TextInput
          label={t("jobs.filters.language")}
          hint={t("jobs.filters.languageHint")}
          value={draft.language}
          maxLength={2}
          onChange={(event) => set("language", event.target.value)}
        />
        <SelectInput
          label={t("jobs.filters.postedWithin.label")}
          value={draft.postedWithin}
          options={POSTED_WITHIN.map((value) => ({
            value,
            label: t(`jobs.filters.postedWithin.${value}`),
          }))}
          onChange={(event) =>
            set("postedWithin", event.target.value as FilterDraft["postedWithin"])
          }
        />
        <SelectInput
          label={t("jobs.filters.visa.label")}
          value={draft.visaSponsorship}
          options={VISA.map((value) => ({
            value: value === "any" ? "" : value,
            label: t(`jobs.filters.visa.${value}`),
          }))}
          onChange={(event) =>
            set("visaSponsorship", event.target.value as FilterDraft["visaSponsorship"])
          }
        />
      </div>

      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
        {checkboxes(
          t("jobs.filters.workModes"),
          WORK_MODES,
          draft.workModes,
          (value) => t(`jobs.results.workMode.${value}`),
          "workModes",
        )}
        {checkboxes(
          t("jobs.filters.employmentTypes"),
          EMPLOYMENT_TYPES,
          draft.employmentTypes,
          (value) => t(`jobs.filters.values.employment.${value}`),
          "employmentTypes",
        )}
        {checkboxes(
          t("jobs.filters.seniorities"),
          SENIORITIES,
          draft.seniorities,
          (value) => t(`jobs.filters.values.seniority.${value}`),
          "seniorities",
        )}
        {checkboxes(t("jobs.filters.sources"), SOURCES, draft.sources, (value) => value, "sources")}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-medium text-app-fg">
          {t("jobs.filters.salary.legend")}
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput
            label={t("jobs.filters.salary.amount")}
            type="number"
            min={0}
            inputMode="numeric"
            value={draft.salaryMin}
            onChange={(event) => set("salaryMin", event.target.value)}
          />
          <SelectInput
            label={t("jobs.filters.salary.currency")}
            value={draft.salaryCurrency}
            options={SALARY_CURRENCIES.map((value) => ({ value, label: value }))}
            onChange={(event) => set("salaryCurrency", event.target.value)}
          />
          <SelectInput
            label={t("jobs.filters.salary.period")}
            value={draft.salaryPeriod}
            options={SALARY_PERIODS.map((value) => ({
              value,
              label: t(`jobs.filters.values.period.${value}`),
            }))}
            onChange={(event) =>
              set("salaryPeriod", event.target.value as FilterDraft["salaryPeriod"])
            }
          />
        </div>
        <CheckboxInput
          label={t("jobs.filters.salary.hideWithout")}
          hint={t("jobs.filters.salary.hideWithoutHint")}
          checked={draft.salaryHideWithout}
          onChange={(event) => set("salaryHideWithout", event.target.checked)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-medium text-app-fg">
          {t("jobs.filters.companies.include")}
        </legend>
        {companies.length === 0 ? (
          <p className="text-sm text-app-muted">{t("jobs.filters.companies.none")}</p>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {companies.map((company) => (
              <CheckboxInput
                key={`in-${company.id}`}
                label={company.name}
                checked={draft.includedCompanyIds.includes(company.id)}
                onChange={() =>
                  set("includedCompanyIds", toggle(draft.includedCompanyIds, company.id))
                }
              />
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-medium text-app-fg">
          {t("jobs.filters.companies.exclude")}
        </legend>
        {companies.length === 0 ? null : (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {companies.map((company) => (
              <CheckboxInput
                key={`out-${company.id}`}
                label={company.name}
                checked={draft.excludedCompanyIds.includes(company.id)}
                onChange={() =>
                  set("excludedCompanyIds", toggle(draft.excludedCompanyIds, company.id))
                }
              />
            ))}
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label={t("jobs.filters.minScore")}
          hint={t("jobs.filters.minScoreHint")}
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          value={draft.minScore}
          onChange={(event) => set("minScore", event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <CheckboxInput
          label={t("jobs.filters.hideDismissed")}
          checked={draft.hideDismissed}
          onChange={(event) => set("hideDismissed", event.target.checked)}
        />
        <CheckboxInput
          label={t("jobs.filters.hideApplied")}
          checked={draft.hideApplied}
          onChange={(event) => set("hideApplied", event.target.checked)}
        />
        <CheckboxInput
          label={t("jobs.filters.newOnly")}
          checked={draft.newOnly}
          onChange={(event) => set("newOnly", event.target.checked)}
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-app-border pt-4">
        <Button type="button" variant="secondary" onClick={onReset}>
          {t("jobs.filters.reset")}
        </Button>
        <Button type="submit">{t("jobs.filters.apply")}</Button>
      </div>
    </form>
  );
}
