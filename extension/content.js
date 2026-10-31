// Runs in every page/frame. Listens for form submissions, snapshots the filled-in
// values (with human-readable labels) and hands them to the service worker,
// which decides whether to keep them.

(() => {
  if (window.__formKeeperInstalled) return;
  window.__formKeeperInstalled = true;

  // Never read these. Hidden inputs are mostly CSRF tokens and tracking ids.
  const SKIP_TYPES = new Set(["password", "hidden", "file", "submit", "button", "reset", "image"]);
  const SKIP_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp\S*)\b/i;
  const MAX_LABEL = 200;

  let lastSignature = "";
  let lastSentAt = 0;

  const clean = (text) => (text || "").replace(/\s+/g, " ").trim();
  const truncate = (text) => (text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text);

  // Text of an element, ignoring any form controls nested inside it (a label
  // wrapping a <select> would otherwise include every option).
  function textWithoutControls(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll("input, select, textarea, button, script, style").forEach((n) => n.remove());
    return clean(copy.textContent);
  }

  function textOfIds(ids) {
    return clean(
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(textWithoutControls)
        .join(" "),
    );
  }

  function ownLabel(el) {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = textOfIds(labelledBy);
      if (text) return text;
    }
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    for (const label of el.labels || []) {
      const text = textWithoutControls(label);
      if (text) return text;
    }
    return "";
  }

  // The question a radio/checkbox group answers: a <legend>, an ARIA group
  // label, or failing that the field name.
  function groupLabel(el) {
    const group = el.closest("fieldset, [role=radiogroup], [role=group]");
    if (group) {
      const legend = group.tagName === "FIELDSET" ? group.querySelector(":scope > legend") : null;
      const text = (legend && textWithoutControls(legend)) || ownLabel(group);
      if (text) return text;
    }
    return el.name || ownLabel(el) || el.id || "Option";
  }

  function fieldLabel(el) {
    return (
      ownLabel(el) ||
      clean(el.getAttribute("placeholder")) ||
      clean(el.getAttribute("title")) ||
      el.name ||
      el.id ||
      "Untitled field"
    );
  }

  function collectFields(form) {
    const fields = [];
    const groups = new Map(); // radio/checkbox groups keyed by name

    for (const el of form.elements) {
      // Unnamed controls are still kept: many script-driven forms (React etc.)
      // never set name attributes but are labelled for accessibility.
      if (el.disabled) continue;
      const tag = el.tagName;
      const type = (el.type || tag).toLowerCase();
      if (tag === "BUTTON" || tag === "FIELDSET" || tag === "OUTPUT" || tag === "OBJECT") continue;
      if (SKIP_TYPES.has(type)) continue;
      if (SKIP_AUTOCOMPLETE.test(el.getAttribute("autocomplete") || "")) continue;

      if (type === "radio" || type === "checkbox") {
        if (!el.checked) continue;
        const standalone =
          type === "checkbox" &&
          !el.closest("fieldset, [role=group]") &&
          [...form.elements].filter((o) => o.type === "checkbox" && o.name === el.name).length === 1;
        if (standalone) {
          // "I agree to the terms" style checkbox: the label is the question.
          const value = el.value && el.value !== "on" ? el.value : "Yes";
          fields.push({ name: el.name || el.id || "", label: truncate(fieldLabel(el)), type, value });
          continue;
        }
        const key = el.name || el.id || groupLabel(el);
        const optionText = ownLabel(el) || el.value;
        const existing = groups.get(key);
        if (existing) {
          existing.value += `, ${optionText}`;
        } else {
          const field = { name: key, label: truncate(groupLabel(el)), type, value: optionText };
          groups.set(key, field);
          fields.push(field);
        }
        continue;
      }

      let value;
      if (tag === "SELECT") {
        value = [...el.selectedOptions].map((o) => clean(o.textContent) || o.value).join(", ");
      } else {
        value = el.value;
      }
      if (value == null || String(value).trim() === "") continue;

      fields.push({
        name: el.name || el.id || "",
        label: truncate(fieldLabel(el)),
        type: tag === "TEXTAREA" ? "textarea" : type,
        value: String(value),
      });
    }
    return fields;
  }

  function formName(form) {
    return clean(
      form.getAttribute("aria-label") ||
        (form.getAttribute("aria-labelledby") && textOfIds(form.getAttribute("aria-labelledby"))) ||
        form.getAttribute("name") ||
        form.id ||
        form.querySelector("h1, h2, h3")?.textContent ||
        "",
    ).slice(0, MAX_LABEL);
  }

  function send(payload) {
    const signature = JSON.stringify([payload.action, payload.fields]);
    const now = Date.now();
    // Double-clicked submit buttons and re-dispatched events.
    if (signature === lastSignature && now - lastSentAt < 3000) return;
    lastSignature = signature;
    lastSentAt = now;
    // Handed over through storage rather than runtime.sendMessage: the page is
    // often navigating away right now, and Chrome drops messages from an
    // unloading frame while it wakes an idle service worker. A storage write
    // is handled by the browser itself and survives the navigation.
    const key = `pending:${now}:${Math.random().toString(36).slice(2)}`;
    try {
      chrome.storage.local.set({ [key]: { ...payload, submittedAt: now } }).catch(() => {});
    } catch {
      // Extension was reloaded/updated; this orphaned script can't talk to it.
    }
  }

  function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    // Snapshot now, in the capture phase, before page handlers clear the form.
    const fields = collectFields(form);
    if (fields.length === 0) return;

    // A submit button's formAction/formMethod override the form's, but only
    // when the attribute is present (formAction otherwise returns the page URL).
    const submitter = event.submitter;
    const method = (submitter?.getAttribute("formmethod") || form.method || "get").toLowerCase();
    const action = submitter?.hasAttribute("formaction") ? submitter.formAction : form.action;
    const payload = {
      url: location.href,
      // Origins of the pages embedding this frame, so site exclusions also
      // cover forms inside iframes.
      ancestorOrigins: [...(location.ancestorOrigins || [])],
      pageTitle: document.title,
      action: action || location.href,
      method,
      formName: formName(form),
      fields,
      handledByScript: false,
    };

    if (method === "post") {
      send(payload);
      return;
    }
    // A GET form whose default action is cancelled is being sent by JavaScript
    // (fetch/XHR), which is how most modern sites submit. Wait until page
    // handlers have run to find out.
    setTimeout(() => send({ ...payload, handledByScript: event.defaultPrevented }), 0);
  }

  window.addEventListener("submit", onSubmit, true);
})();
