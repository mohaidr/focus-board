/* Recurrence rules stay compact; interactive reads expand only their date window. */
const APPOINTMENT_RECURRENCE_METADATA = {
  recurrence: '', recurrence_parent: null, original_date: '', cancelled: 0, reminder_minutes: 15,
};
const APPOINTMENT_REMINDERS = [-1, 0, 5, 15, 30, 60, 1440];

function recurrenceDate(value) {
  return new Date(value + 'T12:00:00Z');
}

function recurrenceDay(date) {
  return date.toISOString().slice(0, 10);
}

function validateAppointmentRecurrence(rule) {
  if (!rule || !['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency) ||
      !Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 99 ||
      !validAppointmentDate(rule.start) ||
      (rule.until !== '' && (!validAppointmentDate(rule.until) || rule.until < rule.start)) ||
      (rule.count !== null && (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 9999)) ||
      !Array.isArray(rule.days) || new Set(rule.days).size !== rule.days.length ||
      rule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
      (rule.frequency === 'weekly' && !rule.days.length)) {
    throw new Error('Choose a valid repeat pattern, interval, weekdays and ending.');
  }
  return rule;
}

function readAppointmentRecurrence(value) {
  return value ? validateAppointmentRecurrence(JSON.parse(value)) : null;
}

function firstAppointmentOccurrence(rule) {
  const date = recurrenceDate(rule.start);
  while (rule.frequency === 'weekly' && !recurrenceOrdinal(rule, recurrenceDay(date))) {
    date.setUTCDate(date.getUTCDate() + 1);
    if ((rule.until && recurrenceDay(date) > rule.until) || date.getUTCFullYear() > 9999) return null;
  }
  return recurrenceDay(date);
}

function recurrenceOrdinal(rule, value) {
  if (value < rule.start || (rule.until && value > rule.until)) return 0;
  const start = recurrenceDate(rule.start);
  const date = recurrenceDate(value);
  const days = Math.round((date - start) / 86400000);
  let ordinal = 0;
  if (rule.frequency === 'daily') {
    if (days % rule.interval) return 0;
    ordinal = days / rule.interval + 1;
  } else if (rule.frequency === 'weekly') {
    const week = Math.floor((days + start.getUTCDay()) / 7);
    if (week % rule.interval || !rule.days.includes(date.getUTCDay())) return 0;
    const first = rule.days.filter(day => day >= start.getUTCDay()).length;
    ordinal = week === 0
      ? rule.days.filter(day => day >= start.getUTCDay() && day <= date.getUTCDay()).length
      : first + (week / rule.interval - 1) * rule.days.length +
        rule.days.filter(day => day <= date.getUTCDay()).length;
  } else {
    const months = (date.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      date.getUTCMonth() - start.getUTCMonth();
    const step = rule.frequency === 'yearly' ? rule.interval * 12 : rule.interval;
    if (months % step || date.getUTCDate() !== start.getUTCDate()) return 0;
    if (rule.frequency === 'yearly' && date.getUTCMonth() !== start.getUTCMonth()) return 0;
    if (rule.count === null) return 1;
    for (let month = 0; month <= months; month += step) {
      const candidate = new Date(start);
      candidate.setUTCDate(1);
      candidate.setUTCMonth(start.getUTCMonth() + month + 1);
      candidate.setUTCDate(0);
      if (start.getUTCDate() <= candidate.getUTCDate()) ordinal++;
      if (ordinal > rule.count) return 0;
    }
  }
  return rule.count === null || ordinal <= rule.count ? ordinal : 0;
}

function appointmentOccurrenceWindow(from = '', to = '') {
  if (from && to) return [from, to];
  const start = recurrenceDate(from || to || dayKey());
  const end = new Date(start);
  if (to) start.setUTCFullYear(Math.max(1, start.getUTCFullYear() - 1));
  else end.setUTCFullYear(Math.min(9999, end.getUTCFullYear() + 1));
  return [recurrenceDay(start), recurrenceDay(end)];
}

function appointmentOccurrenceSource(from = '', to = '') {
  const [start, end] = appointmentOccurrenceWindow(from, to);
  if (!validAppointmentDate(start) || !validAppointmentDate(end)) throw new Error('Invalid occurrence date window');
  const rules = new Map();
  db.create_function('appointment_repeats', (json, date) => {
    if (!json) return 0;
    if (!rules.has(json)) rules.set(json, readAppointmentRecurrence(json));
    return recurrenceOrdinal(rules.get(json), date) > 0 ? 1 : 0;
  });
  const columns = [...APPOINTMENT_COLUMNS, ...Object.keys(APPOINTMENT_TEXT_METADATA)];
  const ordinary = columns.map(column => 'a.' + column).join(', ');
  const recurring = columns.map(column => {
    if (column === 'id') return "CAST(a.id AS TEXT) || ':' || d.day AS id";
    if (column === 'date' || column === 'original_date') return 'd.day AS ' + column;
    if (column === 'recurrence_parent') return 'a.id AS recurrence_parent';
    return 'a.' + column;
  }).join(', ');
  return `(WITH RECURSIVE dates(day) AS (
    SELECT '${start}' UNION ALL SELECT date(day, '+1 day') FROM dates WHERE day < '${end}'
  ) SELECT ${ordinary} FROM appointments a WHERE a.recurrence = '' AND a.cancelled = 0
      AND (a.recurrence_parent IS NULL OR a.date BETWEEN '${start}' AND '${end}')
    UNION ALL SELECT ${recurring} FROM appointments a JOIN dates d ON d.day >= a.date
    WHERE a.recurrence != '' AND a.cancelled = 0 AND appointment_repeats(a.recurrence, d.day)
      AND NOT EXISTS (SELECT 1 FROM appointments e WHERE e.recurrence_parent = a.id AND e.original_date = d.day))`;
}

function appointmentActionId(id) {
  return escAttr(JSON.stringify(id));
}

function appointmentSeriesInfo(appointment) {
  if (!appointment) return null;
  const parent = appointment.recurrence_parent || (appointment.recurrence ? Number(appointment.id) : null);
  if (!parent) return null;
  const master = appointmentRows('SELECT * FROM appointments WHERE id = ?', [parent])[0];
  if (!master || !master.recurrence) throw new Error('Recurring appointment series no longer exists');
  return { master, original: appointment.original_date || appointment.date };
}

function appointmentRecurrenceLabel(series) {
  const rule = readAppointmentRecurrence(series.master.recurrence);
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.frequency];
  const weekdays = rule.frequency === 'weekly'
    ? ' on ' + [...rule.days].sort().map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]).join(', ') : '';
  const ending = rule.until ? ` through ${rule.until}` : rule.count ? `, ${rule.count} occurrences` : ', no end';
  return `Repeats every ${rule.interval} ${unit}${rule.interval === 1 ? '' : 's'}${weekdays}${ending}`;
}

function truncateAppointmentSeries(master, date) {
  const rule = readAppointmentRecurrence(master.recurrence);
  const previous = recurrenceDate(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  if (date <= firstAppointmentOccurrence(rule)) {
    db.run('DELETE FROM appointments WHERE id = ? OR recurrence_parent = ?', [master.id, master.id]);
  } else {
    // Keep the count as well as the new boundary so an earlier count never expands.
    rule.until = recurrenceDay(previous);
    db.run('UPDATE appointments SET recurrence = ? WHERE id = ?', [JSON.stringify(rule), master.id]);
    db.run('DELETE FROM appointments WHERE recurrence_parent = ? AND original_date >= ?', [master.id, date]);
  }
}

function renderAppointmentRepeatControls() {
  return `<div class="form-group"><label for="appointmentEditScope">Apply changes to</label>
      <select id="appointmentEditScope" class="form-select" onchange="changeAppointmentEditScope(this.value)">
        <option value="occurrence">This appointment only</option>
        <option value="future">This and future appointments</option>
        <option value="series">Entire series</option>
      </select>
      <p class="appointment-hint">Series changes replace exceptions in the affected part of the series.</p>
    </div>
    <div class="form-group"><label for="appointmentRepeat">Repeat</label>
      <select id="appointmentRepeat" class="form-select" onchange="toggleAppointmentRepeat()">
        <option value="">Does not repeat</option><option value="daily">Daily</option>
        <option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
      </select>
    </div>
    <fieldset id="appointmentRepeatOptions" hidden><legend>Repeat pattern</legend>
      <div class="form-group"><label for="appointmentRepeatInterval">Repeat every</label>
        <input id="appointmentRepeatInterval" type="number" min="1" max="99" value="1">
        <span class="appointment-hint">Days, weeks, months, or years, according to Repeat.</span></div>
      <div class="form-group" id="appointmentRepeatDays"><span>On weekdays</span>
        <div class="appointment-repeat-days">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) =>
    `<label><input id="appointmentRepeatDay${index}" type="checkbox" value="${index}"> ${day}</label>`).join('')}</div>
      </div>
      <div class="form-group"><label for="appointmentRepeatEnd">Ends</label>
        <select id="appointmentRepeatEnd" class="form-select" onchange="toggleAppointmentRepeat()">
          <option value="never">Never</option><option value="until">On date</option><option value="count">After occurrences</option>
        </select></div>
      <div class="form-group" id="appointmentRepeatUntilWrap"><label for="appointmentRepeatUntil">Last date (inclusive)</label>
        <input id="appointmentRepeatUntil" type="date"></div>
      <div class="form-group" id="appointmentRepeatCountWrap"><label for="appointmentRepeatCount">Number of occurrences</label>
        <input id="appointmentRepeatCount" type="number" min="1" max="9999" value="10"></div>
      <p class="appointment-hint">Times stay on this device's local clock. Months without this day, and non-leap years for February 29, are skipped.</p>
    </fieldset>
    <div class="form-group"><label for="appointmentReminder">Reminder</label>
      <select id="appointmentReminder" class="form-select">${APPOINTMENT_REMINDERS.map((minutes, index) =>
    `<option value="${minutes}" ${minutes === 15 ? 'selected' : ''}>${['Off', 'At start', '5 minutes before', '15 minutes before',
      '30 minutes before', '1 hour before', '1 day before'][index]}</option>`).join('')}</select>
      <p class="appointment-hint">Also alerts at the start, unless Off. Enable reminders in Settings. Dashora must be open.</p>
    </div>`;
}

let appointmentEditContext = null;

function fillAppointmentRepeatControls(appointment) {
  const series = appointmentSeriesInfo(appointment);
  appointmentEditContext = series ? { ...series, occurrence: appointment, scope: 'occurrence' } : null;
  document.getElementById('appointmentEditScope').parentElement.hidden = !series;
  document.getElementById('appointmentEditScope').value = 'occurrence';
  fillAppointmentRepeatRule(series ? series.master : appointment);
  document.getElementById('appointmentReminder').value = appointment?.reminder_minutes ?? 15;
  toggleAppointmentRepeat();
}

function fillAppointmentRepeatRule(appointment) {
  const rule = readAppointmentRecurrence(appointment?.recurrence || '');
  document.getElementById('appointmentRepeat').value = rule?.frequency || '';
  document.getElementById('appointmentRepeatInterval').value = rule?.interval || 1;
  document.getElementById('appointmentRepeatEnd').value = rule?.until ? 'until' : rule?.count ? 'count' : 'never';
  document.getElementById('appointmentRepeatUntil').value = rule?.until || '';
  document.getElementById('appointmentRepeatCount').value = rule?.count || 10;
  const weekday = recurrenceDate(document.getElementById('appointmentDate').value).getUTCDay();
  for (let day = 0; day < 7; day++) {
    document.getElementById('appointmentRepeatDay' + day).checked = rule ? rule.days.includes(day) : day === weekday;
  }
  document.getElementById('appointmentReminder').value = appointment?.reminder_minutes ?? 15;
}

function changeAppointmentEditScope(scope) {
  if (!appointmentEditContext || !['occurrence', 'future', 'series'].includes(scope)) {
    toast('Choose a valid recurring appointment scope');
    return;
  }
  appointmentEditContext.scope = scope;
  const record = scope === 'series' ? appointmentEditContext.master : appointmentEditContext.occurrence;
  document.getElementById('appointmentDate').value = record.date;
  fillAppointmentRepeatRule(scope === 'occurrence' ? record : appointmentEditContext.master);
  if (scope === 'future') {
    const rule = readAppointmentRecurrence(appointmentEditContext.master.recurrence);
    if (rule.count) {
      document.getElementById('appointmentRepeatCount').value =
        rule.count - recurrenceOrdinal(rule, appointmentEditContext.original) + 1;
    }
  }
  toggleAppointmentRepeat();
}

function toggleAppointmentRepeat() {
  const repeat = document.getElementById('appointmentRepeat');
  const single = appointmentEditContext?.scope === 'occurrence';
  repeat.disabled = single;
  const options = document.getElementById('appointmentRepeatOptions');
  options.hidden = !repeat.value || single;
  options.disabled = options.hidden;
  document.getElementById('appointmentRepeatDays').hidden = repeat.value !== 'weekly';
  const ending = document.getElementById('appointmentRepeatEnd').value;
  document.getElementById('appointmentRepeatUntilWrap').hidden = ending !== 'until';
  document.getElementById('appointmentRepeatCountWrap').hidden = ending !== 'count';
}

function readAppointmentRepeatControls(date) {
  const reminder = Number(document.getElementById('appointmentReminder').value);
  if (!APPOINTMENT_REMINDERS.includes(reminder)) throw new Error('Choose a valid reminder');
  const frequency = document.getElementById('appointmentRepeat').value;
  if (!frequency || appointmentEditContext?.scope === 'occurrence') return { recurrence: '', reminder };
  const ending = document.getElementById('appointmentRepeatEnd').value;
  if (!['never', 'until', 'count'].includes(ending)) throw new Error('Choose a valid series ending');
  const rule = validateAppointmentRecurrence({
    frequency, interval: Number(document.getElementById('appointmentRepeatInterval').value), start: date,
    days: Array.from({ length: 7 }, (_, day) => day).filter(day => document.getElementById('appointmentRepeatDay' + day).checked),
    until: ending === 'until' ? document.getElementById('appointmentRepeatUntil').value : '',
    count: ending === 'count' ? Number(document.getElementById('appointmentRepeatCount').value) : null,
  });
  if (ending === 'until' && !rule.until) throw new Error('Choose the series end date');
  if (!firstAppointmentOccurrence(rule)) throw new Error('This repeat pattern has no occurrence before its end date.');
  return { recurrence: JSON.stringify(rule), reminder };
}

function writeAppointmentRecurrence(savedId, repeat, series) {
  const scope = appointmentEditContext?.scope || 'occurrence';
  if (series && scope === 'occurrence') {
    db.run('UPDATE appointments SET recurrence = ?, recurrence_parent = ?, original_date = ?, reminder_minutes = ? WHERE id = ?',
      ['', series.master.id, series.original, repeat.reminder, savedId]);
  } else {
    db.run('UPDATE appointments SET recurrence = ?, recurrence_parent = NULL, original_date = ?, reminder_minutes = ? WHERE id = ?',
      [repeat.recurrence, '', repeat.reminder, savedId]);
  }
}

function findAppointmentWriteConflicts(candidate, repeat) {
  if (!repeat.recurrence) {
    return findAppointmentConflicts(getAppointments(candidate.date, null, candidate), candidate);
  }
  const rule = readAppointmentRecurrence(repeat.recurrence);
  const [from, windowEnd] = appointmentOccurrenceWindow(candidate.date);
  const to = rule.until && rule.until < windowEnd ? rule.until : windowEnd;
  return appointmentRows(`SELECT a.id, a.title, a.date, a.start_time, a.end_time, s.name AS board_name
    FROM ${appointmentOccurrenceSource(from, to)} a JOIN sections s ON s.id = a.section_id
    WHERE a.date >= ? AND a.date <= ? AND appointment_repeats(?, a.date)
      AND a.start_time < ? AND a.end_time > ? AND (? IS NULL OR a.id != ?)
      ${candidate.ignoreSeries ? 'AND (a.recurrence_parent IS NULL OR a.recurrence_parent != ? OR a.original_date < ?)' : ''}
    ORDER BY a.date, a.start_time, a.id LIMIT 21`,
  [from, to, repeat.recurrence, candidate.end_time, candidate.start_time, candidate.id, candidate.id,
    ...(candidate.ignoreSeries ? [candidate.ignoreSeries, candidate.ignoreFrom] : [])]);
}

function openAppointmentDeleteOptions(id) {
  const appointment = getAppointment(id);
  if (!appointment) { toast('Appointment no longer exists'); return; }
  const series = appointmentSeriesInfo(appointment);
  if (!series) { deleteAppointment(id); return; }
  document.getElementById('appointmentDetails').innerHTML = `<h2 id="appointmentDetailsTitle">Delete recurring appointment</h2>
    <p>Choose which appointments to delete. Saved contacts will be kept.</p>
    <div class="form-group"><label for="appointmentDeleteScope">Delete</label>
      <select id="appointmentDeleteScope" class="form-select"><option value="occurrence">This appointment only</option>
        <option value="future">This and future appointments</option><option value="series">Entire series</option></select></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost"
      onclick="openAppointmentDetails(${appointmentActionId(id)})">Cancel</button>
      <button type="button" class="btn btn-primary"
        onclick="deleteAppointment(${appointmentActionId(id)}, document.getElementById('appointmentDeleteScope').value)">Delete</button></div>`;
}

function appendAppointmentReminders(container, now, dismissed) {
  const from = dayKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const to = dayKey(tomorrow);
  const localNow = `${from}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const source = appointmentOccurrenceSource(from, to);
  const sql = `SELECT a.id, a.title, a.date, a.start_time, a.end_time, a.reminder_minutes
    FROM ${source} a WHERE a.date >= ? AND a.date <= ? AND a.reminder_minutes >= 0
      AND a.date || 'T' || a.end_time > ?
    ORDER BY a.date, a.start_time, a.id`;
  // Read bounded batches, including reminders beyond the first visible board page.
  for (let offset = 0; ; offset += 20) {
    const result = db.exec(sql + ' LIMIT ? OFFSET ?', [from, to, localNow, 20, offset]);
    const rows = result.length ? result[0].values : [];
    for (const [id, title, date, start, , minutes] of rows) {
      const starts = new Date(`${date}T${start}:00`);
      const difference = starts - now;
      if (difference > minutes * 60000) continue;
      const phase = difference <= 0 ? 'start' : 'soon';
      const key = `appointment:${id}:${date}:${start}:${phase}`;
      if (dismissed[key]) continue;
      const label = phase === 'start' ? 'Appointment started' : 'Appointment approaching';
      const when = `${appointmentDateLabel(date)} ${start}`;
      container.insertAdjacentHTML('beforeend', `<div class="reminder-banner ${phase === 'start' ? 'reminder-item-overdue' : 'reminder-item-soon'}">
        <div class="reminder-banner-content"><span class="reminder-banner-icon">&#128197;</span>
          <button type="button" class="reminder-banner-text appointment-reminder-link"
            onclick="navigateToAppointment(${appointmentActionId(id)})"><strong>${label}:</strong> ${esc(title)} &middot; ${esc(when)}</button>
          <button type="button" class="reminder-banner-close" aria-label="Dismiss appointment reminder"
            onclick="dismissReminder(${escAttr(JSON.stringify('appointment:' + id))}, ${escAttr(JSON.stringify(`${date}:${start}:${phase}`))})">&times;</button>
        </div></div>`);
      triggerReminderAttention(key, `${label}: ${title}`, when, phase === 'start');
    }
    if (rows.length < 20) break;
  }
}
