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

### Boards and Navigation

- Task boards and reference boards
- Color-coded boards
- Drag-and-drop board ordering
- Global search plus per-board item filtering

### Task Flow (Kanban)

- To Do, In Progress, Done
- Drag items across columns
- Expand/collapse item details
- Optional auto-delete of old completed tasks

### Rich Item Data

- Title, notes, optional link
- Optional Markdown descriptions with Write/Preview controls
- Due date with urgency badges
- Add to Calendar export (.ics)
- Recurring schedules include Daily, Weekly, Biweekly, Monthly, and Specific weekdays
- Optional recurring reminder time

### Markdown Descriptions

In the item editor, change the description **Format** from **Plain text** to **Markdown**.
Use **Write** to edit the source and **Preview** to see the formatted result before saving.
Expand the saved item to see its formatted description on task boards, reference boards, and in search results.

- Existing items, older imports/backups, and new items default to plain text until Markdown is selected
- Titles always remain plain text
- Supports headings, bold/italic, lists, links, images, quotes, tables, strikethrough, and code blocks
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

## License

MIT
