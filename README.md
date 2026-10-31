<img src="extension/icons/icon128.png" width="64" height="64" alt="">

# Form Keeper

A browser extension that keeps a copy of every form you submit — scholarship essays, job applications, support tickets, long comments — so the answers aren't lost the moment you hit **Submit**. Everything is stored locally in your browser; nothing is uploaded anywhere.

## Install (Chrome, Edge, Brave, Arc)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension/` folder.
4. Pin Form Keeper to the toolbar.

There's no build step. After editing the code, click the reload icon on the extension card.

## Using it

- Submit forms as usual. The toolbar icon briefly shows a ✓ when one is saved.
- Click the toolbar icon for recent submissions, a recording on/off switch, and a "save forms on this site" switch.
- **View all saved forms** opens the history page: full-text search across every answer (with highlighting), a filter by site, stars, notes, copy one answer or the whole submission, and export.
- **Settings** (on the history page): pause recording, sites to never record, include GET forms, skip sensitive fields, export/import JSON, delete everything.

## How it works

| Piece | What it does |
| --- | --- |
| `content.js` | Listens for the `submit` event (capture phase, before the page can clear the form) in every page and iframe. Reads each field's value with a human-readable label taken from `<label>`, `aria-label`/`aria-labelledby`, `<legend>` for radio groups, or the placeholder. Hands the snapshot over through `chrome.storage.local`, which survives the page navigating away; `runtime.sendMessage` doesn't when the service worker is asleep. |
| `background.js` | Service worker. Picks up pending snapshots, applies settings and filters, and writes them to IndexedDB. Also watches form `POST` navigations with `webRequest` as a fallback for forms that never fire a `submit` event (e.g. `form.submit()`), and skips any request the content script already captured. |
| `lib/db.js` | IndexedDB wrapper (`form-keeper` database), shared by the worker and the pages. |
| `history.html`, `popup.html`, `ui/` | Viewer and popup. Plain ES modules, no framework. |

**What gets saved:** forms sent with `POST`, plus forms of any method whose submission is handled by JavaScript (the site cancels the default submit and sends the data itself, which is how most modern sites work). Plain `GET` forms are usually searches, so they're skipped unless you turn them on.

**What never gets saved:** password, file, and hidden inputs; fields with `autocomplete` set to passwords, one-time codes, or card details. With **Skip sensitive fields** on (the default), it also skips anything whose name or label looks like a card number, CVV, PIN, SSN, OTP, token, or CSRF value, and any value that passes the Luhn check for a card number.

## Limitations

- Only real `<form>` elements are captured. Some apps (Google Docs-style editors, chat boxes) send data without a form, so nothing triggers a capture.
- Submissions picked up only by the network fallback show raw field names instead of labels, and record the site's origin rather than the exact page.
- Chromium only for now. Firefox would need a `background.scripts` entry in the manifest.
