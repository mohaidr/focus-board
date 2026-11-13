# Dashora Organizer

**A local-first planner for structure without friction.**

Capture a thought. Pick one next step. Keep the rest out of the way.

**No account. No app backend. No automatic cloud sync.**

[Open Dashora](https://dashora.netlify.app/) · [Get started](#start-here) · [Explore features](#features-at-a-glance)

> **Keep a recovery copy.** Your content lives in this browser on this device.
> Clearing site data can remove it. Export important work or connect a backup
> folder. Folder backups need your permission and run only while the app is open.

## Start Here

You do not need to configure everything. Start with one board and one item.

1. **Open [Dashora](https://dashora.netlify.app/).**
2. **Create a board:** select **+ New Board**, choose a type, name, and color.
   - **Task:** things to do, with To Do / In Progress / Done columns.
   - **Reference:** things to keep, such as articles, notes, or sketches.
3. **Add one item and save it.** Expand it when you want to add more detail.

**Next, protect your work:** open **Backups**, select a folder, and grant
read/write access. If your browser does not support folder backups, use
**Export** to download a recovery copy.

**Optional, later:** add due dates, try Markdown, change the theme, or enable
auto-save in **Settings**.

## Features at a Glance

| I want to... | Use this |
| --- | --- |
| See what needs doing | [Task boards and status columns](#1-organize-your-work) |
| Keep useful information nearby | [Reference boards, notes, and sketches](#2-capture-notes-and-ideas) |
| Make a big task feel smaller | [Actionable follow-ups](#follow-ups) |
| Remember a routine or deadline | [Recurring tasks and reminders](#3-support-your-focus) |
| Read without board clutter | [Full-screen reading and collapse controls](#read-with-less-clutter) |
| See progress | [Task dashboard](#task-dashboard) |
| Send someone an item or note | [Read-only share links](#4-share-and-protect-content) |
| Keep a recovery copy | [Backups and JSON export](#5-back-up-and-recover) |
| Use the app without a connection | [Offline use and installation](#6-use-it-offline) |

### A Low-Pressure Workflow

- **Capture first:** a title is enough to get started.
- **Choose one next step:** move it to In Progress.
- **Reduce noise:** collapse columns, items, descriptions, or notes.
- **Return when ready:** the browser remembers your selected board and open/closed views.
- **Build routines gradually:** reminders, recurrence, and auto-save are optional.

Dashora is designed to support focus and reduce cognitive overhead. It is not a
medical product.

## Jump to a Section

- [Organize your work](#1-organize-your-work)
- [Capture notes and ideas](#2-capture-notes-and-ideas)
- [Support your focus](#3-support-your-focus)
- [Share and protect content](#4-share-and-protect-content)
- [Back up and recover](#5-back-up-and-recover)
- [Use it offline](#6-use-it-offline)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Privacy and browser limits](#privacy-and-browser-limits)
- [Run locally and develop](#run-locally-and-develop)
- [AI-generated code notice](#ai-generated-code-notice)

## 1. Organize Your Work

### Boards and Navigation

- **Task boards:** move work through **To Do → In Progress → Done**.
- **Reference boards:** keep information in a flat list, without task statuses.
- **Find things quickly:** global search covers boards; a local filter narrows one board.
- **Arrange your space:** rename boards, choose colors, and drag boards into your preferred order.

<details>
<summary>Board navigation and search details</summary>

- Choose the board type when creating it.
- Without a custom order, boards appear newest first.
- Task/reference groups show item or status counts. **Show more** reveals boards
  in batches of five; **Show less** reduces sidebar clutter.
- The last selected board is remembered in the same browser.
- Global search includes item titles, descriptions, and note titles/bodies.
  Locked protected items are excluded. Unlocked encrypted content is searchable
  while it remains unlocked.
- Smaller screens have a collapsible navigation sidebar.

</details>

### Task Flow

Click a task's status control to cycle through statuses, or use the status
buttons in its expanded details. Drag an item's **grip** to reorder it or move
it between columns.

Collapse individual status columns or item details when you need less on screen.

**Optional cleanup:** Settings can auto-delete completed tasks after **1, 3, 7,
14, or 30 days**. It is off unless enabled; the initial delay is 7 days.

> Deleting a board or item also deletes its associated notes and follow-ups.
> Take a backup first if you may need them later.

### Follow-ups

Break a task into small, actionable steps without creating more board items.

- Add a follow-up with **Add** or **Enter**.
- Check it off or reopen it; incomplete entries appear first.
- Edit with the pencil button or double-click the text.
- Use **Enter** to save; **Escape** or **Cancel** to cancel.
- Delete individual entries. A badge shows completed/total follow-ups.

Follow-ups detect Arabic/English writing direction and travel with exports,
backups, shared snapshots, and the read-only reader. They do **not** change the
parent task's status or count as dashboard tasks.

## 2. Capture Notes and Ideas

### Item Descriptions and Notes

Each item can hold a **title**, **main description**, **multiple notes**, and
an optional **HTTP/HTTPS link**.

**To add a note:** save the item, expand it, then choose **+ Add note** below
the description. Notes are content blocks; follow-ups are actionable steps.

- Give each note an optional title.
- Choose Plain text or Markdown and Auto / LTR / RTL independently.
- Drag a note's grip to reorder it, or focus the grip and use **Alt+Up/Down**.
- Use each note's **Edit**, **Delete**, or **Share** action.

<details>
<summary>Note ordering, saved views, and copying</summary>

- Touch dragging is supported. Order saves automatically and is used in copies,
  share links, full-screen reading, exports, and backups.
- Encrypted note reordering, editing, and deletion require the encryption password.
  Notes are encrypted with the rest of the encrypted item's content.
- A note's editor has a wide desktop Write/Preview area, adapts to smaller
  screens, and scrolls its content separately from the header and Save controls.
- The main description remains separate; adding notes never splits or rewrites it.
- Item, description, and note open/closed states persist in this browser.
  New items start collapsed; new descriptions and notes start expanded.
- Note view states follow their notes through reordering/deletion. The
  full-screen reader uses the same preferences.
- Shared readers remember views per shared item without storing item text in
  those preferences.
- View preferences are not exported or backed up. Import/restore resets them
  so unrelated restored IDs do not inherit an old view.
- Collapsing does not change content, note order, encryption, or backups.
- **Copy** copies the title, main description, ordered note titles/bodies, and
  link as text. Markdown source is retained, not converted to rich HTML.
- Text stays selectable: use **Ctrl+C / Cmd+C** to copy just a passage.
- Notes are searchable and included in sharing, full-screen reading, exports,
  and backups. Older items, backups, and links without notes remain supported.

</details>

### Markdown, Images, and Writing Direction

In the description or note editor, choose **Format → Markdown**.
Use **Write** for the source and **Preview** to check the result.

- Format with the toolbar: headings, emphasis, lists, checklists, quotes,
  code, and links.
- Paste formatted text to convert it to Markdown locally.
- Paste PNG, JPEG, GIF, or WebP screenshots/images to embed them without uploading.
- Choose **Auto**, **Left to right**, or **Right to left** for text direction.

**Plain text remains the default.** Titles always stay plain text.

<details>
<summary>Formatting, paste behavior, and image limits</summary>

- Markdown supports headings, bold/italic, strikethrough, lists, links, images,
  quotes, tables, inline code, and fenced code blocks.
- Inline toolbar actions affect selected text; block actions affect selected
  lines or the current line. Without a selection, replacement placeholders are selected.
- **Ctrl/Cmd+B**, **Ctrl/Cmd+I**, and **Ctrl/Cmd+K** format the focused Markdown
  editor. The Link action selects an example URL for replacement.
- Formatting edits source rather than converting the editor to HTML.
  Native undo/redo is preserved where undo-aware insertion is supported.
  Emphasis actions guard fenced code and whole table rows; use code blocks
  for multiline code.
- Auto direction detects Arabic/Hebrew and English, including individual
  Markdown paragraphs. Titles and follow-ups also detect direction.
- RTL lists, quotes, and tables use direction-aware layouts. Code remains LTR.
  Direction changes do not insert markers or HTML into saved Markdown.
- Format/direction are preserved in previews, readers, sharing, exports, and
  backups. Older content defaults to Plain text and Auto direction.
- HTML clipboard conversion applies only in Markdown Write mode. Plain text
  and text-only clipboard content stay unchanged. Use **Ctrl+Shift+V** to
  paste without conversion.
- Basic pasted tables are supported; a missing header uses the first row.
  Fonts, colors, merged cells, and complex layouts are not preserved.
- Conversion-load failures show a notification and paste text normally.
- Images are embedded as data URLs at the cursor, replacing selected text.
  They appear in previews, expanded items, and the full-screen reader.
- Embedded images are saved, exported, backed up, shared, and encrypted with
  their item. There is **no automatic resizing or compression**.
- Unsupported images/read failures show a notification without changing text.
  If you edit, move the cursor, or leave while an image is being read, paste again.
- Markdown checkboxes are display-only; they do not update task status.
- Original Markdown indentation and line breaks are preserved.
- Raw HTML displays as text; rendered HTML is sanitized with DOMPurify.
- External image URLs can make network requests when displayed. Images load
  lazily and do not send a referrer.
- Markdown dependencies are version-pinned and cached after a successful
  online load.

</details>

### Sketches on Reference Boards

Add an optional sketch to a reference item, alongside its text.

- Draw with a mouse, touch, or supported pen, with pressure when available.
- Switch pen/eraser, adjust stroke size, undo strokes, or clear the canvas.
- Remove a sketch without deleting the item or its text.

Sketches save as PNG images and are included in readers, shares, exports,
backups, and encrypted content. Canvases stay dark in both themes so existing
light-colored strokes remain readable.

### Editing and Auto-save

**Manual save:** use **Save** to save and close the editor. Use **Close** or
**Escape** to exit; unsaved edits prompt for confirmation. Clicking outside
the item editor does not close it.

**Optional auto-save:** enable **Settings → Auto-save items** to save
unprotected item/note edits after about **1.5 seconds** of inactivity, without
closing the editor.

<details>
<summary>Save safety and protected edits</summary>

- Editing a note updates only that note, never the main description.
- Unchanged auto-saves do not create duplicate backup snapshots.
- Protected items and notes require explicit **Save**. Encrypted changes also
  require the appropriate password.
- A failed save keeps the editor open with its draft intact.
- Save is blocked while an image paste or another save is in progress.
- Unsaved note edits, in-flight saves, and pending backup writes trigger
  page-exit warnings where browser rules allow.
- **Do not rely on closing the page to finish saving.**

</details>

## 3. Support Your Focus

### Read with Less Clutter

Use **Full screen** on an item to read without the surrounding board.
Use **Close** or **Escape** to return.

- Read formatted descriptions, ordered notes, links, sketches, and read-only follow-ups.
- Collapse **Description** separately from notes.
- Use **Collapse all / Expand all** beside **Notes**, or toggle one note heading.
- Select and copy text normally.

The reader works on both board types and search results. Focus stays inside it
while open, and closing preserves the item's expanded state. Protected items
must be unlocked; locking or deleting the item closes and clears the reader.

### Due Dates and Recurring Tasks

Add a due date/time for colored urgency badges. Add recurrence for routines
that should return to To Do.

| Schedule | Completed tasks reset to To Do |
| --- | --- |
| Daily | At the next daily reset check |
| Weekly | Mondays |
| Biweekly | The 1st and 15th of each month |
| Monthly | The 1st of each month |
| Specific days | On selected weekdays |

These are **calendar-based rules**, not intervals from the time of completion.
Checks run at startup and periodically while the app is open.

**Add to Calendar** downloads an `.ics` file for a task with a due date:
a one-hour event, the title/main description, and a 15-minute reminder.
It does not include additional notes, create a recurring series, or sync calendars.

### Reminders

Enable **Settings → Due date reminders** for in-app due-soon and overdue banners.
Recurring tasks can also have a reminder time.

- Due-soon banners cover roughly the next 24 hours.
- Recurring-time banners appear within 30 minutes before/after the scheduled
  time on matching days.
- Dismiss a banner without completing or deleting the task.
- Browser notifications, sound, and vibration work where supported and permitted.

> **Reminders are not guaranteed alarms.** A closed app, suspended tab,
> denied permission, or power-saving setting can prevent delivery.

<details>
<summary>Reminder timing and attention signals</summary>

Checks run while the app is open, about once a minute. Recurring reminders
follow the same calendar schedule as recurring tasks.

Due-now/overdue alerts use stronger attention signals. Deduplication avoids
repeatedly announcing the same reminder. Selecting a system notification
focuses an existing app window or opens the app.

Audio may need an initial click or key press before the browser allows playback.

</details>

### Task Dashboard

Open **Dashboard** in the sidebar for a read-only overview:

- Completed tasks per day: **7-day or 30-day** view, including today.
- Current completion rate, open tasks, and overdue tasks.
- Status distribution and per-board progress.
- Board filtering, clickable board names, and accessible daily-count tables.

<details>
<summary>What the dashboard counts</summary>

- Only task-board items count; reference items and follow-ups do not.
- Date filters affect completion activity, not current workload metrics.
- Daily counts use local time. Date-only deadlines become overdue after the
  end of that local day.
- This is a snapshot, **not a permanent activity log**. Deleting, reopening,
  or recurring-resetting a task removes its previous completion from activity.
- Done tasks without a valid completion timestamp count toward progress,
  but not daily activity.
- Calculations stay local and require no extra charting dependencies.

</details>

## 4. Share and Protect Content

### Share an Item or Just One Note

Choose **Share → Copy link** on an item, or **Share** in a saved note's heading.
Recipients get a **read-only snapshot**, not access to your original.

| Share action | Included |
| --- | --- |
| Item | Title, description, ordered notes, formats/directions, link, sketch, task status, due date, recurrence/reminder, and follow-ups |
| Single note | Only that note's title and body, including Markdown, embedded images, and direction |

Recipients can use **Save to board** to make an independent copy. Updating or
deleting your original does not change an existing link.

> **Anyone with the URL can read it.** Shared content is not password-protected,
> even if the original was encrypted. Links cannot be revoked by deleting or
> relocking the original.

<details>
<summary>Share-link behavior and limits</summary>

- Content is UTF-8 JSON encoded in the URL fragment; no server-side record or
  original item ID is needed. Unicode and Markdown are preserved.
- URLs **greater than 2,048 UTF-8 bytes** trigger a length warning. The full URL
  remains available to copy, but may be too long to work reliably.
- Opening a link does not automatically import it. Saving creates a copy in
  an existing or newly created board of the matching type.
- Shared readers support description/note collapse and **Collapse all /
  Expand all**, with separate browser-local view preferences.
- A single-note share becomes a standalone reference snapshot. **Save to board**
  uses its body as the new reference item's description. Untitled notes use
  **Shared note** as the title.
- Single-note links exclude the parent's title, description, other notes,
  link, sketch, task fields, follow-ups, IDs, and passwords. Links/images
  written inside that note remain part of its body.
- Protected content must be unlocked first. Sharing asks you to confirm that
  the copy will be readable; passwords and encryption credentials are excluded.
- Malformed/unsupported links show an error without modifying existing items.
- Sharing can use cached app assets offline, but recipients still need access
  to the app address. Localhost/local-file URLs are not public hosting.
- Links are snapshots, not live collaboration, conversations, or edit invitations.

</details>

### Protect Reference Items

Hide reference content behind a password prompt. Choose a **global password**
in Settings or an **item-specific password** in the editor.

**For encrypted storage, also enable encryption on that protected item.**
Password protection alone hides content in the interface but leaves it
plaintext in browser storage, exports, and backup files.

> **There is no password-reset service.** Encrypted backups still need the
> correct password.

<details>
<summary>Passwords, encryption, and locking</summary>

- New passwords require at least eight characters and confirmation.
  Item-specific passwords override the global password.
- Verifiers use PBKDF2-SHA-256 and random salts; passwords are never saved as plaintext.
- Optional encryption uses AES-256-GCM. It covers the title, main description,
  ordered notes and their formatting/direction, link, and sketch.
- Structural metadata remains outside the encrypted payload: board membership,
  item order, task fields, and the main description's format/direction.
- Encrypted content stays ciphertext in IndexedDB, exports, and backups.
- Keys are derived for the immediate operation and are not persisted or cached.
  Decrypted content necessarily exists in page memory/interface while unlocked.
- Unlocking lasts for the current page session. Reload or use **Lock all**
  to relock; remembered expansion preferences never bypass protection.
- Encrypted saves confirm the global/existing item password. A new item password
  entered in the form is used without asking twice. Password input and derived
  keys are discarded after the operation.
- Changing the global password re-encrypts items that depend on it.
  Removing it requires the current password and is blocked while protected
  items still depend on it.

</details>

## 5. Back Up and Recover

### Choose Your Recovery Method

| Method | Best for | What you need |
| --- | --- | --- |
| **Export** | A downloadable JSON recovery copy or moving content | A modern browser |
| **Folder backups** | Automatic snapshots and in-app recovery controls | A supported browser and a writable folder |
| **Protected backup** | Keeping an important snapshot from automatic cleanup | An existing folder backup |

### Set Up Folder Backups

1. Open **Backups**.
2. Select a specific folder and grant **read/write access**.
3. Choose **Backup now** for an immediate snapshot.
4. Mark important snapshots **Protected** to keep them.

Dashora keeps the **latest 3 regular backups**, plus **every Protected backup**.
Protection prevents automatic pruning; it **does not encrypt** the backup file.

> **Before deleting or replacing data, make a manual backup.**
> A deletion snapshot contains data **after** removal. Recovering a deleted
> item requires an earlier snapshot.

<details>
<summary>Automatic backup timing, retention, and recovery</summary>

- Backups run after item creation, updates, and deletion; note additions,
  edits, deletion, and reordering; new board/follow-up creation; and daily checks.
- Successful auto-save writes trigger backups too. Unchanged auto-saves
  do not create duplicate snapshots.
- Quick task-status changes, whole-board deletions, and follow-up
  edits/completions/deletions do **not** each trigger a dedicated snapshot.
- Daily checks run only while the app is open and skip another daily snapshot
  if a backup already exists for that calendar day.
- A connected, writable folder is required. The browser may ask for permission
  again after reopening or settings changes.
- Writes are queued. Each snapshot is captured when requested so later edits
  do not replace earlier queued content.
- Backup failure does not undo a successful browser save: it is logged and
  shown as a separate warning. Leaving with a pending write also warns.
- Names include date/time, reason, and a unique ID. Protection state is stored
  in both the file content and file name.
- The Backups view shows reason, date, and item count, with **Restore**,
  **Protect/Unprotect**, **Delete**, and folder-disconnection controls.
- Retention applies across all regular backups. Frequent edits can rotate
  older copies quickly; protect or copy anything needed long-term.
- Notes, saved order, and formatting/direction are included. Encrypted content
  stays encrypted.
- Disconnecting a folder leaves existing files on disk.

</details>

### Import and Export

**Export** downloads boards, items, descriptions, ordered notes, sketches,
follow-ups, and global-password settings as JSON. Encrypted content stays encrypted.

**Import replaces all current app data; it does not merge.** The app asks for
confirmation and attempts a pre-import backup if a usable backup folder is connected.

<details>
<summary>What transfers, and what stays in this browser</summary>

- Notes include titles, text, formats, directions, and sequence.
- Older exports/backups without notes or direction fields remain supported.
  Description/note metadata is validated before replacement.
- Import/restore resets local item open/closed preferences.
- Theme, reminder/auto-save settings, other browser-only preferences, and the
  backup-folder connection do not transfer in the content export.
- Export and copy are local downloads/clipboard writes, not cloud sync.
- Importing encrypted content does not remove its password requirement.

</details>

## 6. Use It Offline

After a successful online load, Dashora caches app assets and supported
dependencies for offline use.

If supported, choose your browser's **Install app** or **Add to Home Screen**
to open Dashora in a standalone window.

**Installing is not a backup and does not enable cloud sync.**

<details>
<summary>Offline caching limits</summary>

- The service worker uses network-first updates for local assets, with cached
  fallback. Pinned CDN dependencies use cached copies when available.
- First use needs internet for CDN scripts, WebAssembly, and Google Fonts.
- Uncached resources and externally linked images may still need a connection.
  Offline coverage depends on what the browser successfully cached.
- Clearing site data or changing browser/profile/origin can remove or separate
  local content and preferences.

</details>

## Settings

Open **Settings**, adjust what helps, then use the main **Save** button.

| Setting | What to expect |
| --- | --- |
| **Theme** | Dark by default. Choose Light explicitly; it does not follow the OS theme. |
| **Auto-save items** | Saves unprotected item/note edits after a short pause. Protected content still needs Save. |
| **Due date reminders** | Enables due-date and recurring-time reminders. System notifications need permission. |
| **Auto-delete completed tasks** | Optional cleanup after 1 / 3 / 7 / 14 / 30 days. Off unless enabled. |
| **Reference item password** | Set/change/remove the global password. Individual items can use their own. |

Password controls have separate **Set password / Remove** actions.
Manage your backup folder from **Backups**, not Settings.

<details>
<summary>Theme and Arabic/RTL appearance</summary>

- Theme is saved in this browser, applied before drawing the page, and
  synchronized with other open Dashora tabs.
- Light uses warm **`#f3f1ed`** backgrounds across sidebar, main pane, and header,
  with softer card surfaces rather than bright white panels.
- Arabic/automatically detected RTL text uses **IBM Plex Sans Arabic** from Google
  Fonts, with system fallbacks. Latin UI fonts and monospace code are preserved.
- Both themes cover boards, dashboard, dialogs, editors/previews, reminders,
  and native date/time controls.
- Sketch backgrounds stay dark. Embedded images and stored content are not recolored.

</details>

## Keyboard Shortcuts

Start with **Ctrl+K** to find something and **Escape** to close the active view.

<details>
<summary>All shortcuts</summary>

| Shortcut | Action |
| --- | --- |
| Ctrl+K outside Markdown Write mode | Focus global search |
| Ctrl/Cmd+B, Ctrl/Cmd+I | Bold/italic in the focused Markdown editor |
| Ctrl/Cmd+K in Markdown Write mode | Insert a link |
| Ctrl/Cmd+C | Copy selected text without moving the item |
| Ctrl+Shift+V | Paste plain text without clipboard conversion |
| Alt+Up / Alt+Down on a note's grip | Move the note |
| Enter / Space on a description/note heading or bulk button | Toggle the focused collapse control |
| Enter in a board/item title or password field | Submit that form |
| Enter / Escape in a follow-up editor | Save / cancel |
| Escape | Close the active reader/modal or mobile sidebar; unsaved edits can prompt |
| Ctrl+Z while sketching, outside a text field | Undo a sketch stroke |

Normal text-field undo/redo remains available; sketch undo does not intercept it.

</details>

## Privacy and Browser Limits

**Your app content stays local unless you deliberately share or move it.**
There is no app backend or automatic content-upload service.

- Data belongs to the current **browser profile and app origin**, not an account.
- Another browser, device, or localhost copy has separate storage.
- Loading the hosted app, CDN libraries, Google Fonts, or external images
  still makes network requests to those providers.
- A share URL contains a readable copy. Treat it as sensitive.
- A cloud-synced backup folder may upload files through its own provider;
  Dashora itself does not upload them.

<details>
<summary>Storage details</summary>

- SQLite runs in browser memory via sql.js; app data persists to IndexedDB.
- Boards, items, ordered notes, follow-ups, and password verifiers/salts are
  saved so restored protected content can still be unlocked.
- Encrypted notes live inside the item's encrypted payload.
- Browser-local preferences include theme, auto-save, notifications,
  auto-delete, selected board, and open/closed views.
- Shared-reader view preferences use a payload digest, not shared titles,
  descriptions, or URL contents.
- Theme synchronization between tabs is not general live database synchronization.
- The backup-folder handle is stored separately in IndexedDB metadata.
- JSON backup files are independent of browser cache/site-data cleanup.
  You may need to reconnect the folder afterward.

</details>

<details>
<summary>Browser support and important limitations</summary>

- Use a modern browser with IndexedDB, WebAssembly, and Web Crypto.
  HTTPS or localhost is recommended for the full feature set.
- Folder backups need File System Access API directory-picker support,
  commonly available in Edge and Chrome. Otherwise, use JSON export/import.
- Notifications, vibration, clipboard, pen pressure, and installation vary
  by device/browser and permissions. Audio follows autoplay restrictions.
- Background or closed apps cannot provide reliable scheduled reminders.
- Quotas, private browsing, storage eviction, and clearing site data can affect
  persistence. Keep external recovery copies.
- Large embedded images/sketches increase database, export, backup, and
  share-link size. Share URLs are not a file-transfer service.
- There is no backend-driven collaboration, live comments, cloud sync,
  password recovery, or calendar synchronization. Notes are not chat threads.

</details>

## Run Locally and Develop

The app is static HTML, CSS, and JavaScript. **No build step, package installation,
application backend, or account is required.**

<details>
<summary>Run a local copy</summary>

Serve over localhost rather than opening the HTML directly so service-worker,
WebAssembly, and secure-context features work as intended.

With Git and Python 3 installed, run in PowerShell:

```powershell
git clone https://github.com/mohaidr/focus-board.git
Set-Location focus-board
python -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/).
Any equivalent static server works. Public hosting should serve assets over HTTPS.

Hosted and localhost copies have different browser storage. Use export/import
to move content between them.

</details>

<details>
<summary>Project structure</summary>

```text
focus-board/
|- index.html
|- manifest.json
|- sw.js
|- css/
|  |- style.css
|- js/
|  |- db.js
|  |- dashboard.js
|  |- markdown.js
|  |- share.js
|  |- theme.js
|  |- app.js
|- icons/
|- tests/
|- README.md
```

Database, Markdown/RTL rendering and view preferences, shared snapshots,
dashboard, theme initialization, and main UI logic are separate JavaScript
modules loaded by the page.

</details>

<details>
<summary>Run tests</summary>

Tests use Node.js's built-in runner. No `npm install` is needed.
From the repository root, with a recent Node.js release:

```powershell
node --test
```

For a focused run, choose the relevant file(s):

| Area | Test files inside `tests` |
| --- | --- |
| Share round-trip, validation, exact byte limits | `share.test.js` |
| Dashboard calculations/rendering | `dashboard.test.js` |
| Text selection and drag handles | `selection.test.js` |
| Markdown paste and failure handling | `markdown-paste.test.js` |
| Full-screen reader and protected access | `fullscreen.test.js` |
| Image paste and async editor safety | `image-paste.test.js` |
| Editor close, discard, and save failure | `editor-close.test.js` |
| Formatting, direction, and persistence | `editor-formatting.test.js`, `description-direction.test.js` |
| Notes, ordering, migration, sharing, encryption, auto-save | `notes.test.js`, `note-order.test.js` |
| Saved views and bulk collapse | `view-state.test.js` |
| Backup mutations, queues, retention, failure recovery | `backup.test.js` |
| Theme settings, startup, and contrast | `theme.test.js` |

For example:

```powershell
node --test tests\notes.test.js tests\note-order.test.js
```

Automated tests complement human testing; neither replaces human code review
or a security audit.

</details>

## AI-Generated Code Notice

This app's code is **100% generated by AI**. It has been **tested by a human**,
but **no code review was performed by the human tester**.

Human testing does not guarantee correctness, security, or freedom from defects.
Keep independent backups of important data and use the app at your own discretion.

## License

Dashora uses the [Dashora Organizer Source-Available License 1.1](./LICENSE).
It is **source-available, not open source**.

### Free Noncommercial Use

You may use Dashora for noncommercial purposes, self-host or redistribute
unmodified copies with their notices, and make private personal/internal
modifications. Public forks and pull requests are permitted for contribution
review, not for distributing a separate modified product.

### Commercial Use Requires a Qualifying Contribution

**All business use requires approval**, including internal company use and
business use of the hosted app, even if Dashora itself generates no revenue.

1. **Contribute at least one complete new feature** with genuine practical
   benefit to users.
2. **Have it merged** into the [official repository](https://github.com/mohaidr/focus-board).
3. **Receive explicit written commercial approval** from authorized maintainers
   in the repository, identifying you and the merged feature.

Approval covers **the individual contributor and, if explicitly named, one
organization**, without a license fee. It is not transferable and does not
automatically cover employers, clients, affiliates, or other organizations.
Users of a hosted copy still need approval for their own business use.

**A push, pull request, or merge alone is not enough.** Cosmetic changes,
documentation-only changes, bug fixes alone, placeholders, and token features
do not meet the new-feature requirement. Features must be complete, genuinely
useful, and meet applicable quality requirements. Sham contributions and material
misrepresentation do not earn commercial rights; wanting those rights does not
disqualify a genuinely useful contribution. Acceptance and approval are not guaranteed.

### Restrictions Still Apply

Commercial approval does **not** permit reusing code in other apps, distributing
modified versions outside contribution review, or publicly hosting modified
versions. Those activities require separate written permission.

These restrictions do not apply to your own content or replace third-party
component licenses. See the [full license](./LICENSE) for the governing terms.

**Earlier licenses still apply to earlier copies.** This change cannot revoke
permissions already granted under MIT or license version 1.0, and the contribution
requirement is not retroactive.
