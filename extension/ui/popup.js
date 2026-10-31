import { countSubmissions, listSubmissions } from "../lib/db.js";
import { getSettings, isExcluded, normalizeHost, updateSettings } from "../lib/settings.js";
import { avatar, displayHost, el, preview, relativeTime, title } from "./format.js";

const $ = (id) => document.getElementById(id);
const historyUrl = chrome.runtime.getURL("history.html");

function openHistory(id) {
  chrome.tabs.create({ url: id ? `${historyUrl}#${id}` : historyUrl });
  window.close();
}

async function currentHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab?.url || "");
    return /^https?:$/.test(url.protocol) ? normalizeHost(url.hostname) : "";
  } catch {
    return "";
  }
}

async function render() {
  const [settings, count, all, host] = await Promise.all([
    getSettings(),
    countSubmissions(),
    listSubmissions(),
    currentHost(),
  ]);

  $("count").textContent = `${count} saved submission${count === 1 ? "" : "s"}`;
  $("recording").checked = !settings.paused;

  $("site-row").hidden = !host;
  if (host) {
    $("site-name").textContent = host;
    $("site-enabled").checked = !isExcluded(host, settings.excludedSites);
    $("site-enabled").disabled = settings.paused;
  }

  const recent = all.slice(0, 5);
  $("recent").replaceChildren(
    ...(recent.length
      ? recent.map((s) =>
          el(
            "button",
            { class: "item", onclick: () => openHistory(s.id) },
            avatar(s.hostname),
            el(
              "div",
              { class: "item-body" },
              el(
                "div",
                { class: "item-top" },
                el("span", { class: "item-title" }, title(s)),
                el("span", { class: "muted small" }, relativeTime(s.createdAt)),
              ),
              el("div", { class: "item-preview" }, preview(s) || displayHost(s.hostname)),
            ),
          ),
        )
      : [el("div", { class: "none" }, "Nothing yet — submit a form and it'll appear here.")]),
  );
}

$("recording").addEventListener("change", async (e) => {
  await updateSettings({ paused: !e.target.checked });
  render();
});

$("site-enabled").addEventListener("change", async (e) => {
  const host = $("site-name").textContent;
  const { excludedSites } = await getSettings();
  // Re-enabling removes the host and any parent domain entry that covered it.
  const next = e.target.checked
    ? excludedSites.filter((s) => !isExcluded(host, [s]))
    : [...new Set([...excludedSites, host])].sort();
  await updateSettings({ excludedSites: next });
  render();
});

$("open-history").addEventListener("click", () => openHistory());

render();
