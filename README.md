# Dashora Organizer

Dashora is a local-first planner for people who want structure without friction.

Think of it as a calm command center for your brain:

- Capture quickly
- Sort visually
- Keep momentum
- Recover safely when life gets chaotic

No account. No cloud lock-in. No backend required.

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
- Due date with urgency badges
- Add to Calendar export (.ics)
- Recurring schedules include Daily, Weekly, Biweekly, Monthly, and Specific weekdays
- Optional recurring reminder time

### Reference Board Sketching

- Draw directly in items
- Pen and eraser tools
- Undo and clear canvas

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
|  |- app.js
|- icons/
|- README.md
```

## Data and Storage

### App Data

- Stored as SQLite in browser memory via sql.js
- Persisted to IndexedDB

### Backup Metadata

- Selected backup-folder handle stored in IndexedDB metadata

### Backup Files

- Backups are JSON files written to your selected folder
- Independent from regular browser cache cleanup

## Browser Notes

- File-system backups use the File System Access API
- Notification and audio behavior depends on browser permissions and autoplay rules
- If the app is fully closed, client-side periodic reminder checks do not run

## License

MIT
