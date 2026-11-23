// protects=closing the window follows the saved close behaviour, asks only when it is "ask", maps the prompt's buttons to choices with cancel as the fallback, and remembers only a real keep-running or quit choice;
// fails_when=a saved choice is ignored, an unknown button quits, cancel closes or is remembered, a choice is remembered without the box, or the prompt's cancel button is not the escape button;
// no_claim=how Electron renders the prompt on each platform and the window hide and quit calls are not exercised here.
import { describe, expect, it } from "vitest";
import { createTranslator } from "../i18n";
import { closeAction, closeChoice, closeDialogOptions, rememberedBehavior } from "./close";

describe("close behaviour", () => {
  it("prompts only when the saved behaviour is ask", () => {
    expect(closeAction("ask")).toBe("prompt");
    expect(closeAction("keep-running")).toBe("keep-running");
    expect(closeAction("quit")).toBe("quit");
  });

  it("maps the buttons in order and cancels on an index it does not know", () => {
    expect(closeChoice(0)).toBe("keep-running");
    expect(closeChoice(1)).toBe("quit");
    expect(closeChoice(2)).toBe("cancel");
    expect(closeChoice(7)).toBe("cancel");
    expect(closeChoice(-1)).toBe("cancel");
  });

  it("remembers only a checked keep-running or quit choice", () => {
    expect(rememberedBehavior("quit", true)).toBe("quit");
    expect(rememberedBehavior("keep-running", true)).toBe("keep-running");
    expect(rememberedBehavior("quit", false)).toBeNull();
    expect(rememberedBehavior("cancel", true)).toBeNull();
  });

  it("gives the prompt three buttons with cancel as the escape button", () => {
    const options = closeDialogOptions(createTranslator("en"));
    expect(options.buttons).toEqual(["Keep running", "Quit", "Cancel"]);
    expect(options.cancelId).toBe(2);
    expect(options.checkboxLabel).toBe("Remember my choice");
  });
});
