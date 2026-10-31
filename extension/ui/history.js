import {
  clearSubmissions,
  deleteSubmission,
  importSubmissions,
  listSubmissions,
  updateSubmission,
} from "../lib/db.js";
import { getSettings, normalizeHost, updateSettings } from "../lib/settings.js";
import {
  avatar,
  dayLabel,
  displayHost,
  el,
  highlight,
  matches,
  preview,
  relativeTime,
  submissionAsText,
  title,
} from "./format.js";

const $ = (id) => document.getElementById(id);

const state = {
  all: [],
  visible: [],
  selectedId: Number(location.hash.slice(1)) || null,
  query: "",
  site: "",
  starredOnly: false,
};

// ---------------------------------------------------------------- data

async function load() {
  state.all = await listSubmissions();
  renderSiteFilter();
  render();
}

function applyFilters() {
  state.visible = state.all.filter(
    (s) =>
      (!state.site || s.hostname === state.site) &&
      (!state.starredOnly || s.starred) &&
      matches(s, state.query),
  );
  if (!state.visible.some((s) => s.id === state.selectedId)) {
    state.selectedId = state.visible[0]?.id ?? null;
  }
}

function selected() {
  return state.all.find((s) => s.id === state.selectedId) || null;
}

async function patch(id, changes) {
  const updated = await updateSubmission(id, changes);
  const i = state.all.findIndex((s) => s.id === id);
  if (updated && i !== -1) state.all[i] = updated;
}

// ---------------------------------------------------------------- render

function render() {
  applyFilters();
  renderList();
  renderDetail();
  history.replaceState(null, "", state.selectedId ? `#${state.selectedId}` : location.pathname);
}

function renderSiteFilter() {
  const counts = new Map();
  for (const s of state.all) counts.set(s.hostname, (counts.get(s.hostname) || 0) + 1);
  const select = $("site-filter");
  const hosts = [...counts.keys()].sort((a, b) => displayHost(a).localeCompare(displayHost(b)));
  if (state.site && !counts.has(state.site)) state.site = "";
  select.replaceChildren(
    el("option", { value: "" }, `All sites (${state.all.length})`),
    ...hosts.map((h) => el("option", { value: h, selected: h === state.site }, `${displayHost(h)} (${counts.get(h)})`)),
  );
}

function renderList() {
  const list = $("list");
  const total = state.all.length;
  const shown = state.visible.length;
  $("list-summary").textContent =
    shown === total ? `${total} saved submission${total === 1 ? "" : "s"}` : `${shown} of ${total} submissions`;

  if (total === 0) {
    list.replaceChildren(
      el(
        "div",
        { class: "empty" },
        el("h2", {}, "No forms saved yet"),
        el("p", {}, "Submit a form on any website and it will show up here."),
      ),
    );
    return;
  }
  if (shown === 0) {
    list.replaceChildren(el("div", { class: "empty" }, el("p", {}, "Nothing matches your search.")));
    return;
  }

  const nodes = [];
  let currentDay = "";
  for (const s of state.visible) {
    const day = dayLabel(s.createdAt);
    if (day !== currentDay) {
      currentDay = day;
      nodes.push(el("div", { class: "day" }, day));
    }
    nodes.push(
      el(
        "button",
        {
          class: "item",
          role: "option",
          "aria-selected": String(s.id === state.selectedId),
          "data-id": s.id,
          onclick: () => select(s.id),
        },
        avatar(s.hostname),
        el(
          "div",
          { class: "item-body" },
          el(
            "div",
            { class: "item-top" },
            el("span", { class: "item-title" }, s.starred ? el("span", { class: "star-mark" }, "★ ") : null, title(s)),
            el("span", { class: "muted small", title: new Date(s.createdAt).toLocaleString() }, relativeTime(s.createdAt)),
          ),
          el("div", { class: "muted small" }, displayHost(s.hostname)),
          el("div", { class: "item-preview" }, highlight(preview(s).slice(0, 220), state.query)),
        ),
      ),
    );
  }
  list.replaceChildren(...nodes);
}

function renderDetail() {
  const pane = $("detail");
  const s = selected();
  if (!s) {
    pane.replaceChildren(
      state.all.length
        ? el("div", { class: "empty" }, el("p", {}, "Select a submission to see what you entered."))
        : el(
            "div",
            { class: "empty" },
            el("h2", {}, "Your form history lives here"),
            el(
              "p",
              {},
              "Every time you submit a form — applications, essays, support tickets, sign-ups — Form Keeper saves a copy on this device so you can come back to it.",
            ),
          ),
    );
    return;
  }

  const q = state.query;
  const meta = el(
    "div",
    { class: "detail-meta muted small" },
    el("span", { title: new Date(s.createdAt).toISOString() }, new Date(s.createdAt).toLocaleString()),
    /^https?:/i.test(s.url) ? el("a", { href: s.url, target: "_blank", rel: "noreferrer" }, s.url) : el("span", {}, s.url),
    el("span", {}, el("span", { class: "chip" }, s.method || "post")),
    s.source === "network"
      ? el("span", { title: "Captured from the network request, so field names are shown instead of labels." }, "from request")
      : null,
  );

  const note = el("textarea", { class: "note", placeholder: "Add a note…", rows: 1 });
  note.value = s.note || "";
  note.addEventListener("change", async () => {
    await patch(s.id, { note: note.value });
    toast("Note saved");
  });

  const fields = s.fields.map((f) => {
    const long = f.value.length > 200 || f.value.includes("\n");
    const words = long ? f.value.trim().split(/\s+/).length : 0;
    return el(
      "div",
      { class: `field${long ? " long" : ""}` },
      el(
        "div",
        { class: "field-head" },
        el("span", { class: "field-label" }, highlight(f.label, q)),
        words ? el("span", { class: "muted small" }, `${words} words`) : null,
        el("button", { class: "ghost", onclick: () => copy(f.value, "Answer copied") }, "Copy"),
      ),
      el("pre", { class: "field-value" }, highlight(f.value, q)),
    );
  });

  pane.replaceChildren(
    el(
      "article",
      { class: "detail" },
      el(
        "div",
        { class: "detail-head" },
        avatar(s.hostname),
        el("div", {}, el("h2", {}, title(s)), s.formName && s.formName !== title(s) ? el("div", { class: "muted" }, s.formName) : null, meta),
      ),
      el(
        "div",
        { class: "actions" },
        el("button", { onclick: () => toggleStar(s) }, s.starred ? "★ Starred" : "☆ Star"),
        el("button", { onclick: () => copy(submissionAsText(s), "Submission copied") }, "Copy all"),
        el("button", { onclick: () => download(`form-${s.hostname}-${s.id}.json`, [s]) }, "Export"),
        el("button", { class: "danger", onclick: () => remove(s) }, "Delete"),
      ),
      note,
      fields,
    ),
  );
}

// ---------------------------------------------------------------- actions

function select(id) {
  state.selectedId = id;
  for (const node of $("list").querySelectorAll(".item")) {
    node.setAttribute("aria-selected", String(Number(node.dataset.id) === id));
  }
  renderDetail();
  history.replaceState(null, "", `#${id}`);
  $("detail").scrollTop = 0;
}

async function toggleStar(s) {
  await patch(s.id, { starred: !s.starred });
  render();
}

async function remove(s) {
  if (!confirm(`Delete this submission from ${displayHost(s.hostname)}?`)) return;
  const index = state.visible.findIndex((v) => v.id === s.id);
  await deleteSubmission(s.id);
  state.all = state.all.filter((x) => x.id !== s.id);
  state.selectedId = state.visible[index + 1]?.id ?? state.visible[index - 1]?.id ?? null;
  renderSiteFilter();
  render();
  toast("Deleted");
}

async function copy(text, message) {
  await navigator.clipboard.writeText(text);
  toast(message);
}

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  el("a", { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

// Arrow keys move through the list when focus isn't in a text box.
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select") || $("settings").open) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "j" && e.key !== "k") return;
  const i = state.visible.findIndex((s) => s.id === state.selectedId);
  const next = state.visible[i + (e.key === "ArrowDown" || e.key === "j" ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  select(next.id);
  $("list").querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
});

// ---------------------------------------------------------------- filters

let searchTimer;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    render();
  }, 120);
});
$("site-filter").addEventListener("change", (e) => {
  state.site = e.target.value;
  render();
});
$("starred-only").addEventListener("change", (e) => {
  state.starredOnly = e.target.checked;
  render();
});

// ---------------------------------------------------------------- settings

async function renderSettings() {
  const settings = await getSettings();
  $("set-recording").checked = !settings.paused;
  $("set-sensitive").checked = settings.skipSensitive;
  $("set-get").checked = settings.captureGetForms;
  $("paused-banner").hidden = !settings.paused;
  $("exclude-list").replaceChildren(
    ...settings.excludedSites.map((site) =>
      el(
        "li",
        {},
        site,
        el(
          "button",
          {
            type: "button",
            title: `Stop excluding ${site}`,
            onclick: () => updateSettings({ excludedSites: settings.excludedSites.filter((s) => s !== site) }),
          },
          "×",
        ),
      ),
    ),
  );
}

$("open-settings").addEventListener("click", () => $("settings").showModal());
$("resume").addEventListener("click", () => updateSettings({ paused: false }));
$("set-recording").addEventListener("change", (e) => updateSettings({ paused: !e.target.checked }));
$("set-sensitive").addEventListener("change", (e) => updateSettings({ skipSensitive: e.target.checked }));
$("set-get").addEventListener("change", (e) => updateSettings({ captureGetForms: e.target.checked }));

async function addExcluded() {
  const host = normalizeHost($("exclude-input").value);
  if (!host) return;
  const { excludedSites } = await getSettings();
  if (!excludedSites.includes(host)) await updateSettings({ excludedSites: [...excludedSites, host].sort() });
  $("exclude-input").value = "";
}
$("exclude-add").addEventListener("click", addExcluded);
$("exclude-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addExcluded();
  }
});

$("export").addEventListener("click", () => {
  const date = new Date().toISOString().slice(0, 10);
  download(`form-keeper-${date}.json`, state.all);
});
$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = (Array.isArray(data) ? data : [data]).filter(
      (s) => s && typeof s.createdAt === "number" && Array.isArray(s.fields),
    );
    if (items.length === 0) throw new Error("no submissions found");
    await importSubmissions(items);
    await load();
    toast(`Imported ${items.length} submission${items.length === 1 ? "" : "s"}`);
  } catch (err) {
    alert(`Couldn't import that file: ${err.message}`);
  }
});
$("clear-all").addEventListener("click", async () => {
  if (!confirm(`Permanently delete all ${state.all.length} saved submissions?`)) return;
  await clearSubmissions();
  state.selectedId = null;
  await load();
  toast("All submissions deleted");
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) renderSettings();
});

// New submissions from other tabs show up without a reload.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "submission-added") load();
});

window.addEventListener("hashchange", () => {
  const id = Number(location.hash.slice(1));
  if (id && id !== state.selectedId) select(id);
});

renderSettings();
load();
