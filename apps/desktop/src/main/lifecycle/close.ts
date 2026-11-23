import type { CloseBehavior } from "@job-finder/bridge";
import type { Translate } from "../i18n";

/** The choices of the close prompt, in button order. */
export type CloseChoice = "keep-running" | "quit" | "cancel";

const CHOICES: readonly CloseChoice[] = ["keep-running", "quit", "cancel"];

/** What closing the window does now: `prompt` asks, the other two act. */
export function closeAction(behavior: CloseBehavior): "prompt" | "keep-running" | "quit" {
  return behavior === "ask" ? "prompt" : behavior;
}

/** The choice for a button index of the prompt; an unknown index cancels, so nothing is closed by mistake. */
export function closeChoice(buttonIndex: number): CloseChoice {
  return CHOICES[buttonIndex] ?? "cancel";
}

/** The behaviour to remember, or null when the choice is not remembered or cannot be (cancel). */
export function rememberedBehavior(choice: CloseChoice, remember: boolean): CloseBehavior | null {
  if (!remember || choice === "cancel") return null;
  return choice;
}

/** The prompt's text and buttons. Cancel is the escape button: it closes nothing. */
export function closeDialogOptions(t: Translate) {
  return {
    type: "question" as const,
    message: t("close.message"),
    detail: t("close.detail"),
    buttons: [t("close.keepRunning"), t("close.quit"), t("close.cancel")],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: t("close.remember"),
    checkboxChecked: false,
  };
}
