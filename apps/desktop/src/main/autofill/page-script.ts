/**
 * Scripts the apply window runs in each frame through CDP `Runtime.evaluate`. They are plain
 * JavaScript strings, not bundled functions, so they run unchanged in the page and in the tests.
 * None of them clicks, presses a key, or submits a form: filling sets values and fires input and
 * change events only, and the user is the one who submits.
 */

/** Marks each control with `data-jf-id` and returns the fields of this frame. */
const DISCOVER = `function (prefix) {
  var ROOT = "input, textarea, select";
  var TEXT_TYPES = { "": 1, text: 1, email: 1, tel: 1, url: 1, search: 1, number: 1 };
  var PLACEHOLDER = /select|choose|please|seleziona|scegli|--/i;
  var counter = 0;
  var fields = [];

  function clean(text) {
    return (text || "").replace(/\\s+/g, " ").replace(/\\*+/g, "").replace(/\\(optional\\)/i, "").trim().slice(0, 200);
  }
  function textOf(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    if (/^(SELECT|TEXTAREA|INPUT|OPTION|SCRIPT|STYLE)$/.test(node.tagName)) return "";
    var out = "";
    for (var i = 0; i < node.childNodes.length; i++) out += " " + textOf(node.childNodes[i]);
    return out;
  }
  function rawLabel(el) {
    var parts = [];
    var ids = (el.getAttribute("aria-labelledby") || "").split(/\\s+/);
    for (var i = 0; i < ids.length; i++) {
      var named = ids[i] ? document.getElementById(ids[i]) : null;
      if (named) parts.push(textOf(named));
    }
    if (parts.length === 0 && el.id) {
      var labels = document.querySelectorAll("label");
      for (var j = 0; j < labels.length; j++) {
        if (labels[j].htmlFor === el.id) parts.push(textOf(labels[j]));
      }
    }
    if (parts.length === 0) {
      var wrap = el.closest ? el.closest("label") : null;
      if (wrap) parts.push(textOf(wrap));
    }
    if (parts.length === 0 && el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    if (parts.length === 0 && el.placeholder) parts.push(el.placeholder);
    if (parts.length === 0) {
      // A control with no label of its own (an upload button's input) takes the one label of its block.
      var block = el.closest ? el.closest("div, fieldset, li, section") : null;
      var labels = block ? block.querySelectorAll("label") : [];
      if (labels.length === 1) parts.push(textOf(labels[0]));
    }
    return parts.join(" ");
  }
  function hiddenByStyle(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return true;
      var style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return true;
    }
    return false;
  }
  function offscreenOrInvisible(el) {
    if (el.getClientRects().length === 0) return false;
    var rect = el.getBoundingClientRect();
    return rect.right < -500 || rect.bottom < -500 || rect.left < -1000 || rect.top < -1000 ||
      rect.width <= 1 || rect.height <= 1;
  }
  function honeypot(el, style, label) {
    var tokens = ((el.name || "") + " " + (el.id || "")).toLowerCase();
    if (/honeypot|gotcha|hp[_-]|leave[_-]?blank|do[_-]?not[_-]?fill/.test(tokens)) return true;
    if (/leave (this )?(field )?blank|do not fill/i.test(label)) return true;
    if (offscreenOrInvisible(el)) return true;
    // A field pushed off the page by inline positioning, the usual trap for bots.
    if ((style.position === "absolute" || style.position === "fixed") && parseFloat(style.left) < -500) return true;
    // Any ancestor made transparent hides the control from people.
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (parseFloat(window.getComputedStyle(node).opacity) === 0) return true;
    }
    return false;
  }
  function kindOf(el) {
    if (el.tagName === "SELECT") return "select";
    if (el.tagName === "TEXTAREA") return "textarea";
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "file") return "file";
    if (type === "checkbox") return "checkbox";
    if (TEXT_TYPES[type] === 1) return "text";
    return "other";
  }
  function hasValue(el, kind) {
    if (kind === "file") return el.files !== null && el.files.length > 0;
    if (kind === "checkbox") return el.checked === true;
    if (kind === "select") {
      // A first option with a real value is treated as a choice already made: it is never overwritten.
      var first = el.options.length > 0 ? el.options[0] : null;
      return el.selectedIndex > 0 || (first !== null && first.value !== "" && !PLACEHOLDER.test(first.text));
    }
    return el.value !== "";
  }

  var controls = [];
  (function walk(root) {
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      if (all[i].matches(ROOT)) controls.push(all[i]);
      if (all[i].shadowRoot) walk(all[i].shadowRoot);
    }
  })(document);

  for (var c = 0; c < controls.length; c++) {
    var el = controls[c];
    var kind = kindOf(el);
    if (el.disabled) continue;
    if (kind === "other" && el.tagName === "INPUT") {
      var inputType = (el.getAttribute("type") || "").toLowerCase();
      if (inputType === "hidden" || inputType === "submit" || inputType === "button" || inputType === "image" || inputType === "reset") continue;
    }
    var style = window.getComputedStyle(el);
    var isHoneypot = false;
    if (kind !== "file") {
      if (hiddenByStyle(el)) continue;
      isHoneypot = honeypot(el, style, rawLabel(el));
    }
    var id = prefix + "-" + counter++;
    el.setAttribute("data-jf-id", id);
    var label = clean(rawLabel(el));
    var options = [];
    if (kind === "select") {
      for (var o = 0; o < el.options.length && options.length < 200; o++) {
        options.push({ value: el.options[o].value, text: clean(el.options[o].text) });
      }
    }
    fields.push({
      id: id,
      kind: kind,
      inputType: el.tagName === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase() : "",
      name: (el.getAttribute("name") || "").slice(0, 200),
      label: label,
      autocomplete: (el.getAttribute("autocomplete") || "").slice(0, 60),
      required: el.required === true || el.getAttribute("aria-required") === "true" || /\\*\\s*$/.test(rawLabel(el).trim()),
      hasValue: hasValue(el, kind),
      honeypot: isHoneypot,
      options: options,
      accept: (el.getAttribute("accept") || "").slice(0, 200)
    });
  }
  return fields;
}`;

/** Finds a control by its id in this frame, looking into open shadow roots. */
const FIND = `function (id) {
  function deep(root) {
    var el = root.querySelector('[data-jf-id="' + id + '"]');
    if (el) return el;
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) {
        el = deep(all[i].shadowRoot);
        if (el) return el;
      }
    }
    return null;
  }
  return deep(document);
}`;

/** Sets text, select and yes/no values with the native setters and fires input and change. */
const FILL = `function (actions) {
  function deep(root, id) {
    var el = root.querySelector('[data-jf-id="' + id + '"]');
    if (el) return el;
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) {
        el = deep(all[i].shadowRoot, id);
        if (el) return el;
      }
    }
    return null;
  }
  function setValue(el, value) {
    var proto = Object.getPrototypeOf(el);
    var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (!descriptor || !descriptor.set) return false;
    descriptor.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === value;
  }
  var results = [];
  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    if (action.kind !== "text" && action.kind !== "select") continue;
    var el = deep(document, action.id);
    if (!el) continue;
    if (el.disabled || el.readOnly) {
      results.push({ id: action.id, ok: false, reason: "disabled" });
      continue;
    }
    if (el.value !== "" && !(el.tagName === "SELECT" && el.selectedIndex === 0 && el.value === "")) {
      results.push({ id: action.id, ok: false, reason: "has-value" });
      continue;
    }
    var ok = setValue(el, String(action.value));
    results.push(ok ? { id: action.id, ok: true } : { id: action.id, ok: false, reason: "rejected" });
  }
  return results;
}`;

/** Outlines the given controls and focuses the first one, so the user sees what is left. */
const HIGHLIGHT = `function (ids) {
  function deep(root, id) {
    var el = root.querySelector('[data-jf-id="' + id + '"]');
    if (el) return el;
    var all = root.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) {
        el = deep(all[i].shadowRoot, id);
        if (el) return el;
      }
    }
    return null;
  }
  var first = null;
  var count = 0;
  for (var i = 0; i < ids.length; i++) {
    var el = deep(document, ids[i]);
    if (!el) continue;
    el.style.outline = "3px solid #d97706";
    el.style.outlineOffset = "2px";
    el.setAttribute("data-jf-unfilled", "");
    if (first === null) first = el;
    count++;
  }
  if (first !== null && typeof first.focus === "function") first.focus();
  return count;
}`;

/** The expression that lists this frame's fields. `prefix` keeps ids unique across frames. */
export function discoverExpression(prefix: string): string {
  return `(${DISCOVER})(${JSON.stringify(prefix)})`;
}

/** The expression that fills the given actions in this frame. Actions for other frames are ignored. */
export function fillExpression(
  actions: ReadonlyArray<{ id: string; kind: string; value: string }>,
): string {
  return `(${FILL})(${JSON.stringify(actions)})`;
}

/** The expression that highlights the given unfilled controls and returns how many it found. */
export function highlightExpression(ids: readonly string[]): string {
  return `(${HIGHLIGHT})(${JSON.stringify(ids)})`;
}

/** The expression that returns the control with the given id (for a CDP file upload). */
export function findExpression(id: string): string {
  return `(${FIND})(${JSON.stringify(id)})`;
}
