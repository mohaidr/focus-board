# Dashora Organizer

Dashora is a local-first planner for people who want structure without friction.

Think of it as a calm command center for your brain:

- Capture quickly
- Sort visually
- Keep momentum
- Recover safely when life gets chaotic

No account. No cloud lock-in. No backend required.

Available online at [Dashora](https://dashora.netlify.app/).

## Built For ADHD-Friendly Workflows

Dashora is designed to reduce cognitive overhead, not add to it.

- Clear board structure and simple status flow
- Fast capture with minimal clicks
- Visual cues for urgency
- Recurring tasks so routines do not disappear
- Resilient backup and restore controls

It is not a medical product, but it is intentionally designed to support focus, clarity, and low-friction planning.

## Feature Tour

### Appearance

Open **Settings**, choose **Theme → Light** or **Theme → Dark**, then **Save**.
Dark remains the default. Your choice is saved in this browser, applied before
the page is drawn, and synchronized with other open Dashora tabs.

Light uses a softer warm-gray palette rather than bright white panels.
Arabic and automatically detected RTL text use **Noto Kufi Arabic** from Google
Fonts, with system fallbacks; Latin UI fonts and rendered monospace code are
preserved. Follow-up inputs and text also detect writing direction automatically.

Both themes cover boards, the dashboard, dialogs, Markdown/RTL editing and
previews, reminders, and native date/time controls. Sketch canvases keep their
original dark background so saved drawing colors remain readable; embedded
images and stored item content are not recolored or modified.

### Notes within an Item

Expand a saved task or reference item and choose **+ Add note** below its
description. Notes have an optional title and their own Plain text/Markdown and
Auto/LTR/RTL controls, using the same formatting, preview, image-paste and undo
support as the description editor. Save the item first when creating a new item.
The note editor is wide on desktop, with a roomy Write/Preview area and Save
controls that stay visible while scrolling. It adapts to smaller screens.

With two or more notes, drag a note's grip to place it before or after another
note in the same item. Touch dragging is supported; with the grip focused,
**Alt+Up/Down** also moves the note. The order is saved automatically and used in
copies, share links, full-screen reading and backups. Encrypted reordering asks
for the encryption password, just like editing. Note text stays selectable, and
collapsed notes retain their state when reordered.

Click a note heading to collapse or expand it;
use its **Edit** or **Delete** button to change just that note. The original
description remains separate and is never automatically split or rewritten.
Notes are distinct from actionable follow-ups.
Click **Description** to collapse the main description without hiding the notes
or other item controls. It starts expanded and remembers its collapse state
while the page is open, including in the full-screen reader. Shared readers also
support collapsing the description. This changes only the view, not saved text.

Notes are included in search, clipboard copies, share links, full-screen reading,
exports and backups. Encrypted items encrypt their notes together with the rest
of the content; editing or deleting an encrypted note requires the encryption
password. Older items, backups and share links continue to work without notes.
Unprotected notes also follow the Auto-save setting without closing the editor;
protected notes require Save. Unsaved note edits trigger a warning before leaving.

### Boards and Navigation

- Task boards and reference boards
- Color-coded boards
- Drag-and-drop board ordering
- Global search plus per-board item filtering

### Task Flow (Kanban)

- To Do, In Progress, Done
- Drag items by their grip icon across columns or to reorder them
- Expand/collapse item details
- Optional auto-delete of old completed tasks

### Rich Item Data

- Title, notes, optional link
- Optional Markdown descriptions with Write/Preview controls
- Highlight description text and copy selected passages with Ctrl+C (Cmd+C on macOS)
- Due date with urgency badges
- Add to Calendar export (.ics)
- Recurring schedules include Daily, Weekly, Biweekly, Monthly, and Specific weekdays
- Optional recurring reminder time

The item editor ignores clicks outside its panel. Use **Close** or **Escape**
to exit; after edits, it asks before discarding anything not saved. A simple
event-driven flag tracks edits (no content hashing). The prompt is conservative:
it may still appear after undoing edits or auto-saving. Successful manual saves
close without prompting; failed saves keep the editor open.

### Full-screen Item View

Use the **Full screen** button in an item's quick actions or expanded details to
read it across the entire app viewport. This works on task boards, reference
boards, and search results. The view includes formatted descriptions, links,
sketches, and read-only follow-ups; text remains selectable and copyable.

Use **Close** or **Escape** to return to the board without changing the item or
its expanded state. Keyboard focus stays in the reader while it is open.
Protected and encrypted items must be unlocked first. Locking or deleting the
item also closes the reader and clears its displayed content.

### Task Performance Dashboard

Open **Dashboard** in the sidebar for a local, read-only overview of task boards:

- Completed tasks per day, with a 7-day or 30-day view (including today)
- Current completion rate, open tasks, and overdue tasks
- Task-status distribution and per-board completion progress
- A board filter and clickable board names to return to work
- Accessible daily-count tables alongside the charts

Reference items and follow-ups are excluded. Date filters affect completion activity
only; workload metrics always describe current tasks. Daily counts use your local
time zone. Date-only deadlines are overdue after the end of that local day.

This is a snapshot of stored tasks, not a permanent activity log: deleting a task
(including auto-deletion), reopening it, or resetting a recurring task removes its
previous completion from the dashboard. Done tasks without a valid completion
timestamp still count toward progress, but not daily activity. No data leaves
your device and no extra charting dependencies are required.

### Markdown Descriptions

In the item editor, change the description **Format** from **Plain text** to **Markdown**.
Use **Write** to edit the source and **Preview** to see the formatted result before saving.
Expand the saved item to see its formatted description on task boards, reference boards, and in search results.

- In Markdown **Write** mode, use the toolbar for bold, italic, strikethrough, headings, bulleted/numbered lists, checklists, quotes, inline code, code blocks, and links. Inline formatting applies to selected text; block formatting applies to the selected lines or the current line. With no text selected, placeholders are selected for you to replace
- **Ctrl+B/Cmd+B**, **Ctrl+I/Cmd+I**, and **Ctrl+K/Cmd+K** format the description while it has focus. The Link button inserts a Markdown link and selects its example URL for replacement. Ctrl+K outside the Markdown editor still opens search
- Formatting edits Markdown source directly, without converting the editor to HTML. Native undo/redo is preserved in browsers supporting undo-aware text insertion. Emphasis buttons guard fenced code and whole table rows; use a code block for multiline code
- **Direction** supports **Auto**, **Left to right**, and **Right to left** in both plain text and Markdown. Auto detects Arabic/Hebrew and English, including individual Markdown paragraphs. The choice is saved with the item and preserved in previews, board/search details, the full-screen reader, share links, exports, and backups. Older items and shared links default to Auto
- RTL lists, quotes, and tables use direction-aware layout. Code spans and blocks remain left-to-right; changing direction never adds direction markers or HTML to saved Markdown. Titles also detect their writing direction automatically
- Existing items, older imports/backups, and new items default to plain text until Markdown is selected
- Titles always remain plain text
- Supports headings, bold/italic, lists, links, images, quotes, tables, strikethrough, and code blocks
- In Markdown mode, pasting formatted text converts clipboard HTML to Markdown locally. Plain text mode and text-only clipboard content are unchanged; use Ctrl+Shift+V to paste without conversion
- Paste screenshots or copied PNG, JPEG, GIF, and WebP images into the Markdown description. They are embedded as data URLs at the cursor (replacing selected text), without uploading them. Preview, expanded details, and the full-screen reader display them
- Embedded images are saved with the description, included in exports/backups and share links, and encrypted with encrypted items. Large images increase storage and share-link size; no automatic resizing or compression is applied
- Unsupported image formats and read failures show a notification without changing the description. If you move the cursor, change the description, or leave the editor while an image is being read, paste it again
- Basic tables are supported; the first row becomes the Markdown header if the copied table has none. Fonts, colors, merged cells, and complex layouts are not preserved
- If conversion support fails to load, a notification is shown and the text is pasted normally
- Markdown task-list checkboxes are display-only; they do not change the item's task status
- Original Markdown, including indentation and line breaks, is preserved when editing, saving, exporting, and backing up
- Protected items render only after unlocking; encrypted descriptions remain ciphertext in saved data
- Raw HTML is displayed as text, and rendered HTML is sanitized with DOMPurify
- Image URLs can load external content when the description is displayed; images use lazy loading and do not send a referrer
- Markdown dependencies are version-pinned and cached for offline use after the app has loaded successfully online

For example:

````markdown
## Release notes

- **Review** the changes
- [Open the issue](https://github.com/mohaidr/focus-board/issues)

```js
console.log('Ready');
```
````

### Reference Board Sketching

- Draw directly in items
- Pen and eraser tools
- Undo and clear canvas

### Share an Item

Use an item's **Share** action, then **Copy link**. The URL contains a snapshot of the
title, description and its format, link, sketch, task status, due date, recurring
schedule/reminder, and follow-ups. No server-side record or original item ID is needed.
Content is UTF-8 JSON encoded into the URL fragment, so Unicode and Markdown are preserved.
Updating or deleting the original item does not change an existing shared link.

- The complete URL is measured in UTF-8 bytes; URLs **greater than 2,048 bytes** trigger
  an alert that the URL might be too long to work. The full URL remains available to copy.
- Opening a link shows a read-only item without automatically importing it.
- **Save to board** creates an independent copy in a matching task/reference board.
  Recipients can choose an existing board or create a new one.
- Protected items must be unlocked before sharing. Sharing requires confirmation that
  the URL contains an unprotected copy; passwords and encryption credentials are excluded.
- Anyone with the URL can read the shared content. Shared copies are not password-protected,
  and deleting or relocking the original cannot revoke a link.
- Malformed or unsupported shared links show an error without modifying existing items.
- Sharing works with offline-cached app assets, but recipients still need access to the
  app's address. A localhost or local-file URL is not a publicly hosted app address.

### Protected Reference Items

- Hide a reference item's title, notes, link, and sketch behind a password prompt
- Use one global password or an item-specific password that overrides it
- Passwords are verified with PBKDF2-SHA-256 using random salts and are never stored as plaintext
- Optionally encrypt protected item content with AES-256-GCM
- Encrypted titles, notes, links, and sketches remain ciphertext in IndexedDB, exports, and backups
- Unlock state lasts only for the current page session; reload or use **Lock all** to relock items

Encryption is optional per protected item. Protected items without encryption remain plaintext in IndexedDB, JSON exports, and backup files. Encryption keys are derived for the immediate operation and are never persisted or cached. While an encrypted item is unlocked, its decrypted content necessarily exists transiently in page memory and the rendered interface until the item is locked or the page is reloaded.

Encrypted saves confirm the selected global or existing item password at save time. A new item password entered in the same form is used for that save without asking twice. The password input and derived key are discarded after the operation.

### Reminders and Attention Signals

- In-app due and overdue banners
- Recurring-time reminder banners
- Optional browser notifications
- Sound and vibration cues when supported
- Stronger due-now alert behavior

### Backup, Restore, and Recovery

- Manual backup anytime
- Automatic backup on new board creation, new item creation, and daily cycle
- Backup files saved to a user-selected folder
- File names include date/time and reason
- Restore or delete backups from the Backup tab
- Protect important backups from auto-pruning
- Protection state stored both in file content and file name
- Retention policy keeps the latest 3 regular backups
- Protected backups are excluded from that limit

### Import and Export

- Export full data as JSON
- Import JSON and replace current data

## Quick Start

1. Clone the repository.
2. Open index.html in a modern browser.

```bash
git clone https://github.com/<your-username>/Dashora.git
cd Dashora
start index.html
```

No build step required.

## Keyboard Shortcuts

| Shortcut | Action |
| -------- | ------ |
| Ctrl+K | Focus global search |
| Escape | Close active modal |
| Enter | Submit modal forms |

## Project Structure

```text
Dashora/
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
|  |- app.js
|- icons/
|- README.md
```

## Data and Storage

### App Data

- Stored as SQLite in browser memory via sql.js
- Persisted to IndexedDB
- Password hashes and salts are stored with app data so protected items remain usable after restore

### Backup Metadata

- Selected backup-folder handle stored in IndexedDB metadata

### Backup Files

- Backups are JSON files written to your selected folder
- Independent from regular browser cache cleanup

## Browser Notes

- File-system backups use the File System Access API
- Notification and audio behavior depends on browser permissions and autoplay rules
- If the app is fully closed, client-side periodic reminder checks do not run

## Tests

Run the share URL round-trip, validation, and exact byte-boundary tests with Node.js:

```powershell
node --test tests\share.test.js
```

Run dashboard calculations and rendering tests:

```powershell
node --test tests\dashboard.test.js
```

Run selectable-description and item drag-handle regression tests:

```powershell
node --test tests\selection.test.js
```

Run Markdown paste mode, selection-replacement, and failure-handling tests:

```powershell
node --test tests\markdown-paste.test.js
```

Run full-screen reader and protected-content access tests:

```powershell
node --test tests\fullscreen.test.js
```

Run image paste, supported-format, and asynchronous editor-safety tests:

```powershell
node --test tests\image-paste.test.js
```

Run editor close, discard confirmation, and save-failure tests:

```powershell
node --test tests\editor-close.test.js
```

Run Markdown formatting, keyboard, writing-direction, and persistence regression tests:

```powershell
node --test tests\editor-formatting.test.js tests\description-direction.test.js
```

Run multiple-note, legacy migration, sharing, encryption, and auto-save tests:

```powershell
node --test tests\notes.test.js tests\note-order.test.js
```

Run theme preference, settings, startup, and light-palette contrast tests:

```powershell
node --test tests\theme.test.js
```

## License

MIT
