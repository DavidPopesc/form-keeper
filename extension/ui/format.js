// Small helpers shared by the popup and the history page.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0d9488", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#db2777"];

export function avatar(hostname) {
  const host = (hostname || "?").replace(/^www\./, "");
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return el("div", { class: "avatar", style: `background:${AVATAR_COLORS[hash % AVATAR_COLORS.length]}` }, host[0]);
}

export function displayHost(hostname) {
  return (hostname || "unknown site").replace(/^www\./, "");
}

export function title(submission) {
  return submission.pageTitle || submission.formName || displayHost(submission.hostname);
}

/** The most interesting value to preview: the longest answer. */
export function preview(submission) {
  const longest = [...submission.fields].sort((a, b) => b.value.length - a.value.length)[0];
  return longest ? `${longest.label}: ${longest.value}` : "";
}

export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** Text with case-insensitive matches of `query` wrapped in <mark>. */
export function highlight(text, query) {
  const frag = document.createDocumentFragment();
  if (!query) {
    frag.append(text);
    return frag;
  }
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, i)) {
    frag.append(text.slice(i, at), el("mark", {}, text.slice(at, at + q.length)));
    i = at + q.length;
  }
  frag.append(text.slice(i));
  return frag;
}

export function submissionAsText(submission) {
  const lines = [
    title(submission),
    submission.url,
    new Date(submission.createdAt).toLocaleString(),
    "",
  ];
  for (const f of submission.fields) lines.push(`${f.label}\n${f.value}\n`);
  return lines.join("\n").trim();
}

export function matches(submission, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [submission.pageTitle, submission.formName, submission.url, submission.hostname, submission.note];
  for (const f of submission.fields) haystack.push(f.label, f.value);
  return haystack.some((s) => s && s.toLowerCase().includes(q));
}
