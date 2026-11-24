import { useTranslation } from "react-i18next";
import { ChipsInput } from "./ChipsInput";
import type { SkillDraft } from "./profile-draft";

export interface SkillChipsProps {
  skills: SkillDraft[];
  onChange: (skills: SkillDraft[]) => void;
}

/** Skills as chips. A level or aliases a skill already has are kept, but are not edited here. */
export function SkillChips({ skills, onChange }: SkillChipsProps) {
  const { t } = useTranslation();
  const named = skills.filter((skill) => skill.name.trim() !== "");
  return (
    <ChipsInput
      label={t("profile.sections.skills")}
      values={named.map((skill) => skill.name)}
      onChange={(names) =>
        onChange(
          names.map(
            (name) =>
              named.find((skill) => skill.name === name) ?? { name, level: "", aliases: "" },
          ),
        )
      }
      addLabel={t("profile.skillsEditor.add")}
      hint={t("profile.skillsEditor.addHint")}
      emptyText={t("profile.skillsEditor.empty")}
      removeLabel={(name) => t("profile.skillsEditor.remove", { name })}
    />
  );
}
