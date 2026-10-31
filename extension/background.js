import { addSubmission, listSubmissionsBetween } from "./lib/db.js";
import { getSettings, isExcluded } from "./lib/settings.js";
import { isSensitiveField } from "./lib/sensitive.js";

const PENDING_PREFIX = "pending:";
const NETWORK_DEDUPE_MS = 5000;

const inFlight = new Set();

const withoutHash = (url) => String(url || "").split("#")[0];

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isSearchOnly(fields) {
  return fields.every((f) => f.type === "search" || /^(q|query|search|s|keywords?)$/i.test(f.name));
}

async function save(record, urlsToCheck) {
  const settings = await getSettings();
  if (settings.paused) return null;
  if (urlsToCheck.some((u) => u && isExcluded(hostnameOf(u), settings.excludedSites))) return null;

  const fields = settings.skipSensitive ? record.fields.filter((f) => !isSensitiveField(f)) : record.fields;
  if (fields.length === 0) return null;

  const submission = {
    ...record,
    fields,
    hostname: hostnameOf(record.url),
    createdAt: record.createdAt || Date.now(),
    starred: false,
  };
  submission.id = await addSubmission(submission);

  flashBadge();
  // Let any open history page refresh. Nobody listening is fine.
  chrome.runtime.sendMessage({ type: "submission-added", id: submission.id }).catch(() => {});
  return submission.id;
}

let badgeTimer;
function flashBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#7c3aed" });
  chrome.action.setBadgeText({ text: "✓" });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}

// Primary path: the content script saw a <form> submit event, read the values
// with their labels, and left them in storage under a "pending:" key.
async function processPending(key, p) {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await chrome.storage.local.remove(key);
    const settings = await getSettings();
    const isPost = p.method === "post";
    if (!isPost && !p.handledByScript && !settings.captureGetForms) return;
    if (!isPost && isSearchOnly(p.fields)) return;

    await save(
      {
        source: "form",
        url: p.url,
        pageTitle: p.pageTitle || "",
        action: p.action,
        method: p.method,
        formName: p.formName,
        fields: p.fields,
        createdAt: p.submittedAt,
      },
      [p.url, ...(p.ancestorOrigins || [])],
    );
  } catch (err) {
    console.error("Form Keeper: failed to save submission", err);
  } finally {
    inFlight.delete(key);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key.startsWith(PENDING_PREFIX) && newValue) processPending(key, newValue);
  }
});

// Anything written while the worker was starting up, or left over from a
// worker that was shut down mid-save.
async function sweepPending() {
  const all = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PENDING_PREFIX)) processPending(key, value);
  }
}
sweepPending();

// Whether the content script already reported this request: a submission to
// the same action around the same time with overlapping field names, either
// still pending or already saved. Checked against storage rather than memory
// because the worker may have restarted in between.
async function capturedByContentScript(action, time, names) {
  const sameForm = (fields) => {
    const named = fields.filter((f) => f.name);
    return named.length === 0 || named.some((f) => names.has(f.name));
  };
  const near = (t) => Math.abs(t - time) < NETWORK_DEDUPE_MS;

  const pending = await chrome.storage.local.get(null);
  for (const [key, p] of Object.entries(pending)) {
    if (!key.startsWith(PENDING_PREFIX)) continue;
    if (withoutHash(p.action) === action && near(p.submittedAt) && sameForm(p.fields)) return true;
  }
  const saved = await listSubmissionsBetween(time - NETWORK_DEDUPE_MS, time + NETWORK_DEDUPE_MS);
  return saved.some((s) => s.source === "form" && withoutHash(s.action) === action && sameForm(s.fields));
}

// Fallback path: a form POST navigation the content script didn't report, e.g.
// one sent with form.submit() (which fires no submit event) or from a page the
// content script couldn't run in. Only field names are available here.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.method !== "POST" || !details.requestBody?.formData || details.tabId < 0) return;
    const formData = details.requestBody.formData;
    const startedAt = Date.now();

    // Give the content script's report a moment to arrive first.
    setTimeout(async () => {
      const fields = Object.entries(formData)
        .map(([name, values]) => ({ name, label: name, type: "text", value: values.join(", ") }))
        .filter((f) => f.value.trim() !== "");
      if (fields.length === 0) return;

      const names = new Set(fields.map((f) => f.name));
      if (await capturedByContentScript(withoutHash(details.url), startedAt, names)) return;

      const pageUrl = details.initiator || details.url;
      save(
        {
          source: "network",
          url: pageUrl,
          pageTitle: "",
          action: details.url,
          method: "post",
          formName: "",
          fields,
          createdAt: startedAt,
        },
        [pageUrl, details.url],
      ).catch((err) => console.error("Form Keeper: failed to save request", err));
    }, 1500);
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame"] },
  ["requestBody"],
);
