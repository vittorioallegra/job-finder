import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  PROFILE_LIMITS,
  SALARY_PERIODS,
  type ProfileRecord,
  type SalaryPeriod,
} from "@job-finder/bridge";
import { useBridge } from "../../lib/bridge/BridgeContext";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { SelectInput, type SelectOption } from "../../components/ui/SelectInput";
import { TextArea } from "../../components/ui/TextArea";
import { TextInput } from "../../components/ui/TextInput";
import { profileFromDraft, type ProfileDraft } from "./profile-draft";

type SaveState = "idle" | "saving" | "saved" | "invalid" | "error";

export interface ProfileEditorProps {
  initialDraft: ProfileDraft;
  /** Called with the stored record after a successful save. */
  onSaved?: (record: ProfileRecord) => void;
}

/** Edits every profile field. Nothing is saved until the form is submitted and passes the schema. */
export function ProfileEditor({ initialDraft, onSaved }: ProfileEditorProps) {
  const { t } = useTranslation();
  const bridge = useBridge();
  const [draft, setDraft] = useState<ProfileDraft>(initialDraft);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  function set<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
  }

  function setDefaults(patch: Partial<ProfileDraft["applicationDefaults"]>) {
    setDraft((current) => ({
      ...current,
      applicationDefaults: { ...current.applicationDefaults, ...patch },
    }));
    setSaveState("idle");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = profileFromDraft(draft);
    if (profile === null) {
      setSaveState("invalid");
      return;
    }
    setSaveState("saving");
    try {
      const record = await bridge.profile.save(profile);
      setSaveState("saved");
      onSaved?.(record);
    } catch {
      setSaveState("error");
    }
  }

  const periodOptions: SelectOption[] = SALARY_PERIODS.map((period) => ({
    value: period,
    label: period === "" ? t("profile.periods.none") : t(`profile.periods.${period}`),
  }));
  const relocateOptions: SelectOption[] = [
    { value: "", label: t("profile.relocate.unset") },
    { value: "yes", label: t("profile.relocate.yes") },
    { value: "no", label: t("profile.relocate.no") },
  ];
  const levelHint = t("profile.fields.levelHint");

  return (
    <form onSubmit={save} className="flex flex-col gap-6" noValidate>
      <Section id="profile-contact" title={t("profile.sections.contact")} columns>
        <TextInput
          label={t("profile.fields.fullName")}
          value={draft.contact.fullName}
          maxLength={PROFILE_LIMITS.shortText}
          onChange={(event) => set("contact", { ...draft.contact, fullName: event.target.value })}
        />
        <TextInput
          label={t("profile.fields.email")}
          type="email"
          value={draft.contact.email}
          maxLength={PROFILE_LIMITS.email}
          onChange={(event) => set("contact", { ...draft.contact, email: event.target.value })}
        />
        <TextInput
          label={t("profile.fields.phone")}
          type="tel"
          value={draft.contact.phone}
          maxLength={PROFILE_LIMITS.shortText}
          onChange={(event) => set("contact", { ...draft.contact, phone: event.target.value })}
        />
        <TextInput
          label={t("profile.fields.location")}
          value={draft.contact.location}
          maxLength={PROFILE_LIMITS.shortText}
          onChange={(event) => set("contact", { ...draft.contact, location: event.target.value })}
        />
      </Section>

      <Section id="profile-summary" title={t("profile.sections.summary")}>
        <TextInput
          label={t("profile.fields.headline")}
          value={draft.headline}
          maxLength={PROFILE_LIMITS.shortText}
          onChange={(event) => set("headline", event.target.value)}
        />
        <TextArea
          label={t("profile.fields.summary")}
          value={draft.summary}
          maxLength={PROFILE_LIMITS.longText}
          onChange={(event) => set("summary", event.target.value)}
        />
      </Section>

      <Section id="profile-experience" title={t("profile.sections.experience")}>
        <ListEditor
          items={draft.experience}
          onItems={(items) => set("experience", items)}
          newItem={() => ({
            company: "",
            title: "",
            location: "",
            startDate: "",
            endDate: "",
            bullets: "",
          })}
          addLabel={t("profile.add.experience")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.company")}
                value={item.company}
                onChange={(event) => change({ company: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.jobTitle")}
                value={item.title}
                onChange={(event) => change({ title: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.location")}
                value={item.location}
                onChange={(event) => change({ location: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.startDate")}
                value={item.startDate}
                onChange={(event) => change({ startDate: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.endDate")}
                value={item.endDate}
                onChange={(event) => change({ endDate: event.target.value })}
              />
              <TextArea
                label={t("profile.fields.bullets")}
                hint={t("profile.fields.bulletsHint")}
                value={item.bullets}
                onChange={(event) => change({ bullets: event.target.value })}
              />
            </>
          )}
        />
      </Section>

      <Section id="profile-education" title={t("profile.sections.education")}>
        <ListEditor
          items={draft.education}
          onItems={(items) => set("education", items)}
          newItem={() => ({ institution: "", degree: "", field: "", startDate: "", endDate: "" })}
          addLabel={t("profile.add.education")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.institution")}
                value={item.institution}
                onChange={(event) => change({ institution: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.degree")}
                value={item.degree}
                onChange={(event) => change({ degree: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.field")}
                value={item.field}
                onChange={(event) => change({ field: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.startDate")}
                value={item.startDate}
                onChange={(event) => change({ startDate: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.endDate")}
                value={item.endDate}
                onChange={(event) => change({ endDate: event.target.value })}
              />
            </>
          )}
        />
      </Section>

      <Section id="profile-skills" title={t("profile.sections.skills")}>
        <ListEditor
          items={draft.skills}
          onItems={(items) => set("skills", items)}
          newItem={() => ({ name: "", level: "", aliases: "" })}
          addLabel={t("profile.add.skill")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.skillName")}
                value={item.name}
                onChange={(event) => change({ name: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.skillLevel")}
                hint={levelHint}
                value={item.level}
                onChange={(event) => change({ level: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.aliases")}
                hint={t("profile.fields.aliasesHint")}
                value={item.aliases}
                onChange={(event) => change({ aliases: event.target.value })}
              />
            </>
          )}
        />
      </Section>

      <Section id="profile-languages" title={t("profile.sections.languages")}>
        <ListEditor
          items={draft.languages}
          onItems={(items) => set("languages", items)}
          newItem={() => ({ name: "", level: "" })}
          addLabel={t("profile.add.language")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.languageName")}
                value={item.name}
                onChange={(event) => change({ name: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.languageLevel")}
                hint={levelHint}
                value={item.level}
                onChange={(event) => change({ level: event.target.value })}
              />
            </>
          )}
        />
      </Section>

      <Section id="profile-certifications" title={t("profile.sections.certifications")}>
        <ListEditor
          items={draft.certifications}
          onItems={(items) => set("certifications", items)}
          newItem={() => ({ name: "", issuer: "", date: "" })}
          addLabel={t("profile.add.certification")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.certName")}
                value={item.name}
                onChange={(event) => change({ name: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.issuer")}
                value={item.issuer}
                onChange={(event) => change({ issuer: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.date")}
                value={item.date}
                onChange={(event) => change({ date: event.target.value })}
              />
            </>
          )}
        />
      </Section>

      <Section id="profile-links" title={t("profile.sections.links")}>
        <ListEditor
          items={draft.links}
          onItems={(items) => set("links", items)}
          newItem={() => ({ label: "", url: "" })}
          addLabel={t("profile.add.link")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.linkLabel")}
                value={item.label}
                onChange={(event) => change({ label: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.linkUrl")}
                type="url"
                value={item.url}
                onChange={(event) => change({ url: event.target.value })}
              />
            </>
          )}
        />
      </Section>

      <Section id="profile-defaults" title={t("profile.sections.defaults")}>
        <ListEditor
          items={draft.applicationDefaults.workAuthorization}
          onItems={(items) => setDefaults({ workAuthorization: items })}
          newItem={() => ({ country: "", status: "" })}
          addLabel={t("profile.add.workAuthorization")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.country")}
                hint={t("profile.fields.countryHint")}
                maxLength={2}
                value={item.country}
                onChange={(event) => change({ country: event.target.value })}
              />
              <TextInput
                label={t("profile.fields.status")}
                value={item.status}
                onChange={(event) => change({ status: event.target.value })}
              />
            </>
          )}
        />
        <TextInput
          label={t("profile.fields.noticePeriod")}
          value={draft.applicationDefaults.noticePeriod}
          maxLength={PROFILE_LIMITS.shortText}
          onChange={(event) => setDefaults({ noticePeriod: event.target.value })}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextInput
            label={t("profile.fields.salaryAmount")}
            type="number"
            inputMode="decimal"
            min={0}
            value={draft.applicationDefaults.salaryAmount}
            onChange={(event) => setDefaults({ salaryAmount: event.target.value })}
          />
          <TextInput
            label={t("profile.fields.salaryCurrency")}
            hint={t("profile.fields.currencyHint")}
            maxLength={3}
            value={draft.applicationDefaults.salaryCurrency}
            onChange={(event) => setDefaults({ salaryCurrency: event.target.value })}
          />
          <SelectInput
            label={t("profile.fields.salaryPeriod")}
            options={periodOptions}
            value={draft.applicationDefaults.salaryPeriod}
            onChange={(event) => setDefaults({ salaryPeriod: event.target.value as SalaryPeriod })}
          />
        </div>
        <SelectInput
          label={t("profile.fields.relocate")}
          options={relocateOptions}
          value={draft.applicationDefaults.willingToRelocate}
          onChange={(event) =>
            setDefaults({ willingToRelocate: event.target.value as "" | "yes" | "no" })
          }
        />
        <TextInput
          label={t("profile.fields.pronouns")}
          value={draft.applicationDefaults.pronouns}
          maxLength={PROFILE_LIMITS.shortText}
          onChange={(event) => setDefaults({ pronouns: event.target.value })}
        />
      </Section>

      <Section id="profile-answers" title={t("profile.sections.answers")}>
        <ListEditor
          items={draft.standardAnswers}
          onItems={(items) => set("standardAnswers", items)}
          newItem={() => ({ question: "", answer: "" })}
          addLabel={t("profile.add.answer")}
          entryLabel={(number) => t("profile.entry", { number })}
          removeLabel={(number) => t("profile.remove", { number })}
          renderFields={(item, change) => (
            <>
              <TextInput
                label={t("profile.fields.question")}
                value={item.question}
                onChange={(event) => change({ question: event.target.value })}
              />
              <TextArea
                label={t("profile.fields.answer")}
                value={item.answer}
                maxLength={PROFILE_LIMITS.longText}
                onChange={(event) => change({ answer: event.target.value })}
              />
            </>
          )}
        />
      </Section>

      <div className="sticky bottom-4 flex items-center justify-end gap-4 rounded-2xl border border-app-border bg-app-surface/95 px-5 py-3 shadow-pop backdrop-blur">
        <p
          role="status"
          className={`text-sm ${saveState === "saved" ? "text-app-good" : saveState === "invalid" || saveState === "error" ? "text-app-danger" : "text-app-muted"}`}
        >
          {saveState === "saved" ? t("profile.saved") : null}
          {saveState === "invalid" ? t("profile.invalid") : null}
          {saveState === "error" ? t("profile.saveFailed") : null}
        </p>
        <Button type="submit" disabled={saveState === "saving"}>
          {saveState === "saving" ? t("profile.saving") : t("profile.save")}
        </Button>
      </div>
    </form>
  );
}

function Section({
  id,
  title,
  columns = false,
  children,
}: {
  id: string;
  title: string;
  /** Lay the fields out in two columns from the small breakpoint up. */
  columns?: boolean;
  children: ReactNode;
}) {
  return (
    <Card as="section" aria-labelledby={id} className="flex flex-col gap-4">
      <CardTitle id={id}>{title}</CardTitle>
      <div className={columns ? "grid gap-4 sm:grid-cols-2" : "flex flex-col gap-4"}>
        {children}
      </div>
    </Card>
  );
}

interface ListEditorProps<T> {
  items: T[];
  onItems: (items: T[]) => void;
  newItem: () => T;
  addLabel: string;
  entryLabel: (number: number) => string;
  removeLabel: (number: number) => string;
  renderFields: (item: T, change: (patch: Partial<T>) => void) => ReactNode;
}

/** Repeatable entries. Each entry is a labelled group with its own remove button. */
function ListEditor<T>({
  items,
  onItems,
  newItem,
  addLabel,
  entryLabel,
  removeLabel,
  renderFields,
}: ListEditorProps<T>) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => (
        <div
          key={index}
          role="group"
          aria-label={entryLabel(index + 1)}
          className="flex flex-col gap-3 rounded-xl bg-app-sunken/60 p-4"
        >
          {renderFields(item, (patch) =>
            onItems(
              items.map((current, position) =>
                position === index ? { ...current, ...patch } : current,
              ),
            ),
          )}
          <div className="flex justify-end">
            <Button
              variant="danger"
              size="sm"
              onClick={() => onItems(items.filter((_, position) => position !== index))}
            >
              {removeLabel(index + 1)}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button variant="secondary" size="sm" onClick={() => onItems([...items, newItem()])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
