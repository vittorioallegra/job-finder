import { useId, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { PROFILE_LIMITS } from "@job-finder/bridge";
import type { SkillDraft } from "./profile-draft";

export interface SkillChipsProps {
  skills: SkillDraft[];
  onChange: (skills: SkillDraft[]) => void;
}

/**
 * Skills as chips: type a name and press Enter or a comma to add it, click × to remove it. A level
 * or aliases a skill already has are kept, but are not edited here.
 */
export function SkillChips({ skills, onChange }: SkillChipsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState("");

  function add(raw: string) {
    const names = raw
      .split(",")
      .map((name) => name.trim().slice(0, PROFILE_LIMITS.shortText))
      .filter((name) => name !== "");
    const known = new Set(skills.map((skill) => skill.name.trim().toLowerCase()));
    const added: SkillDraft[] = [];
    for (const name of names) {
      if (known.has(name.toLowerCase())) continue;
      known.add(name.toLowerCase());
      added.push({ name, level: "", aliases: "" });
    }
    if (added.length > 0) onChange([...skills, ...added]);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(text);
    } else if (event.key === "Backspace" && text === "" && skills.length > 0) {
      onChange(skills.slice(0, -1));
    }
  }

  const visible = skills.filter((skill) => skill.name.trim() !== "");
  return (
    <div className="flex flex-col gap-2">
      {visible.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("profile.sections.skills")}>
          {visible.map((skill, index) => (
            <li
              key={`${skill.name}-${index}`}
              className="flex items-center gap-1 rounded-full bg-app-sunken py-1 pr-1 pl-3 text-sm text-app-fg"
            >
              {skill.name}
              <button
                type="button"
                aria-label={t("profile.skillsEditor.remove", { name: skill.name })}
                className="grid size-5 place-items-center rounded-full text-app-muted hover:bg-app-border hover:text-app-fg"
                onClick={() => onChange(skills.filter((item) => item !== skill))}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-app-muted">{t("profile.skillsEditor.empty")}</p>
      )}
      <label htmlFor={id} className="sr-only">
        {t("profile.skillsEditor.add")}
      </label>
      <input
        id={id}
        value={text}
        placeholder={t("profile.skillsEditor.add")}
        aria-describedby={`${id}-hint`}
        className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-fg shadow-card transition-colors placeholder:text-app-subtle hover:border-app-subtle focus:border-app-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-soft"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(text)}
      />
      <p id={`${id}-hint`} className="text-xs text-app-muted">
        {t("profile.skillsEditor.addHint")}
      </p>
    </div>
  );
}
