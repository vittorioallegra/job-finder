import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { PRESENT, formatProfileDate, parseProfileDate } from "@job-finder/bridge";
import { CheckboxInput } from "../../components/ui/CheckboxInput";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";

/** Years offered, newest first: next year down to this one. */
const FIRST_YEAR = 1960;

export interface MonthYearInputProps {
  label: string;
  /** The stored date: `YYYY-MM`, `YYYY`, `present`, empty, or text from a CV the parser could not read. */
  value: string;
  onChange: (value: string) => void;
  /** End dates offer "still going on", stored as `present`. */
  allowPresent?: boolean;
}

/**
 * A month (optional) and a year, as most CVs write dates. A date read from a CV that is in no known
 * shape stays as it was until the user picks one, and is shown under the pickers.
 */
export function MonthYearInput({
  label,
  value,
  onChange,
  allowPresent = false,
}: MonthYearInputProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const parsed = parseProfileDate(value);
  const unread = value.trim() !== "" && parsed === null;
  const present = parsed === PRESENT;
  const year = parsed !== null && parsed !== PRESENT ? parsed.year : null;
  const storedMonth = parsed !== null && parsed !== PRESENT ? parsed.month : null;
  // A month picked before a year waits here until the year makes it a date.
  const [pendingMonth, setPendingMonth] = useState<number | null>(null);
  const month = year === null ? pendingMonth : storedMonth;

  const monthName = new Intl.DateTimeFormat(i18n.language, { month: "long" });
  const monthOptions: SelectOption[] = [
    { value: "", label: t("profile.date.noMonth") },
    ...Array.from({ length: 12 }, (_, index) => {
      const name = monthName.format(new Date(2000, index, 1));
      return { value: String(index + 1), label: name.charAt(0).toUpperCase() + name.slice(1) };
    }),
  ];
  const lastYear = new Date().getFullYear() + 1;
  const yearOptions: SelectOption[] = [
    { value: "", label: t("profile.date.noYear") },
    ...Array.from({ length: lastYear - FIRST_YEAR + 1 }, (_, index) => {
      const option = String(lastYear - index);
      return { value: option, label: option };
    }),
  ];

  function pick(nextYear: number | null, nextMonth: number | null) {
    if (nextYear === null) {
      setPendingMonth(nextMonth);
      onChange("");
      return;
    }
    onChange(formatProfileDate({ year: nextYear, month: nextMonth }));
  }

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={unread ? `${id}-cv` : undefined}
    >
      <legend className="mb-1.5 text-[13px] font-medium text-app-fg">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <SelectInput
          label={t("profile.date.month")}
          hideLabel
          options={monthOptions}
          value={month === null ? "" : String(month)}
          disabled={present}
          onChange={(event) =>
            pick(year, event.target.value === "" ? null : Number(event.target.value))
          }
        />
        <SelectInput
          label={t("profile.date.year")}
          hideLabel
          options={yearOptions}
          value={year === null ? "" : String(year)}
          disabled={present}
          onChange={(event) =>
            pick(event.target.value === "" ? null : Number(event.target.value), month)
          }
        />
      </div>
      {allowPresent ? (
        <CheckboxInput
          label={t("profile.date.current")}
          checked={present}
          onChange={(event) => onChange(event.target.checked ? PRESENT : "")}
        />
      ) : null}
      {unread ? (
        <p id={`${id}-cv`} className="text-xs text-app-muted">
          {t("profile.date.fromCv", { value })}
        </p>
      ) : null}
    </fieldset>
  );
}
