/* Daily schedules and contacts shared by appointment boards. */
let appointmentDay = '';
let appointmentMonth = '';
let contactSearchTerm = '';
let appointmentSavePending = false;
let contactSavePending = false;
let appointmentWritePending = false;

const CONTACT_COLUMNS = ['id', 'name', 'phone', 'email', 'notes'];
const APPOINTMENT_COLUMNS = ['id', 'section_id', 'contact_id', 'person_name', 'person_phone',
  'person_email', 'person_notes', 'title', 'date', 'start_time', 'end_time', 'description', 'location'];

function appointmentRows(sql, params = []) {
  const result = db.exec(sql, params);
  return result.length ? result[0].values.map(row =>
    Object.fromEntries(result[0].columns.map((column, index) => [column, row[index]]))) : [];
}

function validAppointmentDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) > 0 && !isNaN(Date.parse(value + 'T12:00:00Z')) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}

function validAppointmentTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function appointmentMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function appointmentDateLabel(date) {
  return new Date(date + 'T12:00:00').toLocaleDateString(undefined,
    { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function getContacts() {
  return appointmentRows('SELECT * FROM contacts ORDER BY name COLLATE NOCASE, id');
}

function getAppointments(date = null, sectionId = null) {
  return appointmentRows(`SELECT a.*, s.name AS board_name, c.name AS contact_name,
    c.phone AS contact_phone, c.email AS contact_email, c.notes AS contact_notes
    FROM appointments a JOIN sections s ON s.id = a.section_id
    LEFT JOIN contacts c ON c.id = a.contact_id
    WHERE 1 = 1 ${date === null ? '' : 'AND a.date = ?'} ${sectionId === null ? '' : 'AND a.section_id = ?'}
    ORDER BY a.date, a.start_time, a.end_time, a.id`,
  [...(date === null ? [] : [date]), ...(sectionId === null ? [] : [sectionId])]).map(hydrateAppointmentContact);
}

function searchAppointments(term) {
  return getAppointments().filter(appointment =>
    [appointment.title, appointment.description, appointment.person_name, appointment.person_phone,
      appointment.person_email, appointment.person_notes, appointment.location, appointment.board_name, appointment.date]
      .some(value => value.toLowerCase().includes(term)));
}

function renderAppointmentSearchMatches(appointments) {
  return appointments.map(appointment => `<button type="button" class="appointment-agenda-entry"
    onclick="navigateToAppointment(${appointment.id})">
    <span>${esc(appointment.date)} ${esc(appointment.start_time)} - ${esc(appointment.end_time)}</span>
    <strong dir="auto">${esc(appointment.title)}</strong><span dir="auto">${esc(appointment.person_name)}</span>
    <span dir="auto">${esc(appointment.board_name)}</span></button>`).join('');
}

function navigateToAppointment(id) {
  const appointment = getAppointment(id);
  if (!appointment) { toast('Appointment no longer exists'); return; }
  appointmentDay = appointment.date;
  appointmentMonth = appointment.date.slice(0, 7);
  document.getElementById('searchBox').value = '';
  selectSection(appointment.section_id);
  openAppointmentDetails(id);
}

function hydrateAppointmentContact(appointment) {
  if (appointment.contact_name !== null && appointment.contact_name !== undefined) {
    return { ...appointment, person_name: appointment.contact_name,
      person_phone: appointment.contact_phone, person_email: appointment.contact_email,
      person_notes: appointment.contact_notes };
  }
  return appointment;
}

function getAppointment(id) {
  const row = appointmentRows(`SELECT a.*, s.name AS board_name, c.name AS contact_name,
    c.phone AS contact_phone, c.email AS contact_email, c.notes AS contact_notes
    FROM appointments a JOIN sections s ON s.id = a.section_id
    LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.id = ?`, [id])[0];
  return row ? hydrateAppointmentContact(row) : null;
}

function findAppointmentConflicts(appointments, candidate) {
  return appointments.filter(other => other.id !== candidate.id && other.date === candidate.date &&
    other.start_time < candidate.end_time && other.end_time > candidate.start_time);
}

// Short appointments need a minimum visual height; lanes prevent their cards obscuring each other.
function layoutAppointments(appointments) {
  const sorted = appointments.map(appointment => ({ ...appointment,
    start: appointmentMinutes(appointment.start_time),
    end: Math.min(1440, Math.max(appointmentMinutes(appointment.end_time),
      appointmentMinutes(appointment.start_time) + 30)) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id);
  let group = [];
  let ends = [];
  let groupEnd = 0;
  const finish = () => group.forEach(appointment => { appointment.lanes = ends.length; });
  for (const appointment of sorted) {
    if (appointment.start >= groupEnd) {
      finish();
      group = [];
      ends = [];
    }
    let lane = ends.findIndex(end => end <= appointment.start);
    if (lane === -1) lane = ends.length;
    appointment.lane = lane;
    ends[lane] = appointment.end;
    group.push(appointment);
    groupEnd = Math.max(...ends);
  }
  finish();
  return sorted;
}

function setAppointmentDay(value) {
  if (!validAppointmentDate(value)) { toast('Choose a valid date'); return; }
  appointmentDay = value;
  appointmentMonth = value.slice(0, 7);
  renderMain();
}

function moveAppointmentDay(offset) {
  const date = new Date(appointmentDay + 'T12:00:00');
  date.setDate(date.getDate() + offset);
  setAppointmentDay(dayKey(date));
}

function moveAppointmentMonth(offset) {
  const date = new Date(appointmentMonth + '-01T12:00:00');
  date.setMonth(date.getMonth() + offset);
  appointmentMonth = dayKey(date).slice(0, 7);
  renderMain();
}

function renderAppointmentCalendar() {
  const first = new Date(appointmentMonth + '-01T12:00:00');
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = dayKey();
  let html = `<section class="appointment-calendar" aria-label="Choose appointment day">
    <div class="appointment-toolbar">
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Previous month" onclick="moveAppointmentMonth(-1)">&lt;</button>
      <h3>${esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h3>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Next month" onclick="moveAppointmentMonth(1)">&gt;</button>
    </div><div class="appointment-month-grid">`;
  for (const label of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
    html += `<span class="appointment-weekday">${label}</span>`;
  }
  for (let index = 0; index < first.getDay(); index++) html += '<span></span>';
  for (let day = 1; day <= days; day++) {
    const key = `${appointmentMonth}-${String(day).padStart(2, '0')}`;
    html += `<button type="button" class="appointment-calendar-day ${key === appointmentDay ? 'selected' : ''}"
      aria-label="${escAttr(appointmentDateLabel(key))}" aria-pressed="${key === appointmentDay}"
      ${key === today ? 'aria-current="date"' : ''} onclick="setAppointmentDay('${key}')">${day}</button>`;
  }
  return html + `</div><label class="appointment-date-label" for="appointmentDayPicker">Jump to date</label>
    <input class="form-select" type="date" id="appointmentDayPicker" value="${appointmentDay}"
      onchange="setAppointmentDay(this.value)"></section>`;
}

function renderAppointmentBoard(id, name, color) {
  if (!appointmentDay) appointmentDay = dayKey();
  if (!appointmentMonth) appointmentMonth = appointmentDay.slice(0, 7);
  const appointments = getAppointments(appointmentDay, id);
  document.getElementById('mainHeader').innerHTML = `
    <div class="main-header-left">
      <button class="sidebar-toggle" type="button" aria-label="Open navigation menu" onclick="toggleSidebar()">&#9776;</button>
      <div class="section-color-big" style="background:${escAttr(color)}"></div><h2>${esc(name)}</h2>
    </div><div class="board-actions">
      <button class="btn btn-ghost btn-sm" onclick="openSectionModal(${id})">Edit Board</button>
      <button class="btn btn-ghost btn-sm" onclick="deleteSection(${id})">Delete Board</button>
    </div>`;
  let hours = '';
  for (let hour = 0; hour < 24; hour++) {
    const time = String(hour).padStart(2, '0') + ':00';
    hours += `<button type="button" class="appointment-hour" style="top:${hour * 64}px"
      aria-label="Add appointment at ${time}" onclick="openAppointmentModal(null, '${time}')"><span>${time}</span></button>`;
  }
  const cards = layoutAppointments(appointments).map(appointment => `
    <button type="button" class="appointment-card" onclick="openAppointmentDetails(${appointment.id})"
      style="top:${appointment.start / 60 * 64}px;height:${(appointment.end - appointment.start) / 60 * 64}px;left:calc(64px + (100% - 64px) * ${appointment.lane / appointment.lanes});width:calc((100% - 64px) / ${appointment.lanes} - 4px)"
      aria-label="${escAttr(`${appointment.start_time} to ${appointment.end_time}, ${appointment.title}, ${appointment.person_name}`)}">
      <strong dir="auto">${esc(appointment.title)}</strong>
      <span dir="auto">${esc(appointment.person_name)} &middot; ${appointment.start_time} - ${appointment.end_time}</span>
    </button>`).join('');
  document.getElementById('mainBody').innerHTML = `<div class="appointment-layout">
    <aside>${renderAppointmentCalendar()}
      <button class="btn btn-ghost btn-block" onclick="selectContactsTab()">Manage contacts</button>
    </aside>
    <section class="appointment-day" aria-label="Daily schedule">
      <div class="appointment-toolbar">
        <button class="btn btn-ghost btn-sm" aria-label="Previous day" onclick="moveAppointmentDay(-1)">&lt;</button>
        <button class="btn btn-ghost btn-sm" onclick="setAppointmentDay(dayKey())">Today</button>
        <button class="btn btn-ghost btn-sm" aria-label="Next day" onclick="moveAppointmentDay(1)">&gt;</button>
        <button class="btn btn-primary btn-sm" onclick="openAppointmentModal()">+ Appointment</button>
      </div>
      <h3>${esc(appointmentDateLabel(appointmentDay))}</h3>
      <p class="appointment-hint">${appointments.length} appointment${appointments.length === 1 ? '' : 's'} &middot; Times are local to this device. Click an hour to book.</p>
      <div class="appointment-agenda" aria-label="Appointments for selected day">
        ${appointments.length ? appointments.map(appointment => `<button type="button" class="appointment-agenda-entry"
          onclick="openAppointmentDetails(${appointment.id})"><span>${appointment.start_time} - ${appointment.end_time}</span>
          <strong dir="auto">${esc(appointment.title)}</strong><span dir="auto">${esc(appointment.person_name)}</span></button>`).join('')
    : '<p class="appointment-hint">No appointments today. Choose a time below to add one.</p>'}
      </div>
      <div class="appointment-timeline-scroll" id="appointmentTimeline"><div class="appointment-timeline">${hours}${cards}</div></div>
    </section></div>`;
  document.getElementById('appointmentTimeline').scrollTop =
    Math.max(0, (appointments.length ? appointmentMinutes(appointments[0].start_time) / 60 - 1 : 8) * 64);
}

function selectContactsTab() {
  activeView = 'contacts';
  document.getElementById('searchBox').value = '';
  renderSidebar();
  renderMain();
  closeSidebar();
}

function renderContacts() {
  const contacts = getContacts().filter(contact =>
    [contact.name, contact.phone, contact.email, contact.notes].some(value =>
      value.toLowerCase().includes(contactSearchTerm)));
  document.getElementById('mainHeader').innerHTML = `<div class="main-header-left">
    <button class="sidebar-toggle" type="button" aria-label="Open navigation menu" onclick="toggleSidebar()">&#9776;</button>
    <h2>Contacts</h2></div><button class="btn btn-primary" onclick="openContactModal()">+ Create contact</button>`;
  document.getElementById('mainBody').innerHTML = `<p class="appointment-hint">Shared across all appointment boards.</p>
    <label class="appointment-date-label" for="contactSearch">Find a contact</label>
    <div class="section-search-wrap">
      <input class="section-search" id="contactSearch" type="search" value="${escAttr(contactSearchTerm)}"
        placeholder="Search name, phone, email or notes" oninput="filterContacts(this.value)">
    </div>
    <div class="contact-grid">${contacts.map(contact => `<button class="contact-card" type="button" onclick="openContactModal(${contact.id})">
      <strong dir="auto">${esc(contact.name)}</strong><span dir="auto">${esc(contact.phone)}</span>
      <span dir="auto">${esc(contact.email)}</span><span class="appointment-hint">View / edit contact</span></button>`).join('')
    || '<p class="appointment-hint">No contacts found. Create one here or save a new person while booking an appointment.</p>'}</div>`;
}

function filterContacts(value) {
  contactSearchTerm = value.toLowerCase();
  renderContacts();
  const input = document.getElementById('contactSearch');
  input.focus();
}

function ensureAppointmentModals() {
  if (document.getElementById('appointmentModal')) return;
  const personFields = prefix => `
    <div class="form-group"><label for="${prefix}Name">Person's name *</label><input id="${prefix}Name" dir="auto" required maxlength="200"></div>
    <div class="appointment-form-row">
      <div class="form-group"><label for="${prefix}Phone">Phone</label><input id="${prefix}Phone" type="tel" dir="auto"></div>
      <div class="form-group"><label for="${prefix}Email">Email</label><input id="${prefix}Email" type="email" dir="auto"></div>
    </div>
    <div class="form-group"><label for="${prefix}Notes">Contact notes</label><textarea id="${prefix}Notes" dir="auto"></textarea></div>`;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="appointmentModal">
      <form class="modal appointment-editor" id="appointmentForm" role="dialog" aria-modal="true" aria-labelledby="appointmentModalTitle" onsubmit="saveAppointment(event)">
        <h2 id="appointmentModalTitle">New appointment</h2>
        <input type="hidden" id="appointmentId"><input type="hidden" id="appointmentSection">
        <div class="form-group"><label for="appointmentTitle">Appointment title *</label><input id="appointmentTitle" dir="auto" required maxlength="300"></div>
        <div class="form-group"><label for="appointmentDate">Date *</label><input id="appointmentDate" type="date" required></div>
        <div class="appointment-form-row">
          <div class="form-group"><label for="appointmentStart">Start time *</label><input id="appointmentStart" type="time" required></div>
          <div class="form-group"><label for="appointmentEnd">End time *</label><input id="appointmentEnd" type="time" required></div>
        </div>
        <div class="form-group"><label for="appointmentContact">Person *</label>
          <select class="form-select" id="appointmentContact" onchange="onAppointmentContactChange()"></select>
        </div>
        <fieldset id="appointmentNewPerson"><legend>New person</legend>${personFields('appointmentPerson')}
          <label class="appointment-checkbox"><input type="checkbox" id="appointmentSaveContact" checked> Save contact for future appointments</label>
        </fieldset>
        <p class="appointment-hint" id="appointmentExistingContact" hidden></p>
        <div class="form-group"><label for="appointmentDescription">Appointment description</label><textarea id="appointmentDescription" dir="auto"></textarea></div>
        <div class="form-group"><label for="appointmentLocation">Location / meeting link</label><input id="appointmentLocation" dir="auto"></div>
        <div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="closeModal('appointmentModal')">Cancel</button>
          <button class="btn btn-primary" id="appointmentSaveButton" type="submit">Save appointment</button></div>
      </form>
    </div>
    <div class="modal-overlay" id="appointmentDetailsModal">
      <section class="modal appointment-editor" role="dialog" aria-modal="true" aria-labelledby="appointmentDetailsTitle" id="appointmentDetails"></section>
    </div>
    <div class="modal-overlay" id="contactModal">
      <form class="modal" id="contactForm" role="dialog" aria-modal="true" aria-labelledby="contactModalTitle" onsubmit="saveContact(event)">
        <h2 id="contactModalTitle">Create contact</h2><input type="hidden" id="contactId">${personFields('contactPerson')}
        <p class="appointment-hint">Contact updates appear in all linked appointments.</p>
        <div class="modal-actions"><button class="btn btn-ghost" type="button" onclick="closeModal('contactModal')">Cancel</button>
          <button class="btn btn-primary" id="contactSaveButton" type="submit">Save contact</button></div>
      </form>
    </div>`);
}

function fillPersonFields(prefix, person) {
  for (const [suffix, field] of [['Name', 'name'], ['Phone', 'phone'], ['Email', 'email'], ['Notes', 'notes']]) {
    document.getElementById(prefix + suffix).value = person[field] || '';
  }
}

function readPersonFields(prefix) {
  return Object.fromEntries([['Name', 'name'], ['Phone', 'phone'], ['Email', 'email'], ['Notes', 'notes']]
    .map(([suffix, field]) => [field, document.getElementById(prefix + suffix).value.trim()]));
}

function fillAppointmentContactOptions(selected = '') {
  document.getElementById('appointmentContact').innerHTML = `<option value="">Enter a new person</option>` +
    getContacts().map(contact => `<option value="${contact.id}">${esc(contact.name)}${contact.phone || contact.email
      ? ' - ' + esc(contact.phone || contact.email) : ''}</option>`).join('');
  document.getElementById('appointmentContact').value = selected;
  onAppointmentContactChange();
}

function onAppointmentContactChange() {
  const id = Number(document.getElementById('appointmentContact').value);
  const fieldset = document.getElementById('appointmentNewPerson');
  fieldset.hidden = !!id;
  fieldset.disabled = !!id;
  const summary = document.getElementById('appointmentExistingContact');
  summary.hidden = !id;
  if (id) {
    const contact = getContacts().find(contact => contact.id === id);
    summary.textContent = contact ? [contact.name, contact.phone, contact.email].filter(Boolean).join(' | ') : '';
  }
}

function openAppointmentModal(id = null, start = '09:00') {
  ensureAppointmentModals();
  const appointment = id === null ? null : getAppointment(id);
  if (id !== null && !appointment) { toast('Appointment no longer exists'); return; }
  document.getElementById('appointmentForm').reset();
  document.getElementById('appointmentModalTitle').textContent = appointment ? 'Edit appointment' : 'New appointment';
  document.getElementById('appointmentId').value = appointment ? appointment.id : '';
  document.getElementById('appointmentSection').value = appointment ? appointment.section_id : activeSectionId;
  document.getElementById('appointmentTitle').value = appointment ? appointment.title : '';
  document.getElementById('appointmentDate').value = appointment ? appointment.date : appointmentDay || dayKey();
  document.getElementById('appointmentStart').value = appointment ? appointment.start_time : start;
  const endMinutes = Math.min(1439, appointmentMinutes(start) + 60);
  document.getElementById('appointmentEnd').value = appointment ? appointment.end_time
    : `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  document.getElementById('appointmentDescription').value = appointment ? appointment.description : '';
  document.getElementById('appointmentLocation').value = appointment ? appointment.location : '';
  fillPersonFields('appointmentPerson', appointment ? { name: appointment.person_name,
    phone: appointment.person_phone, email: appointment.person_email, notes: appointment.person_notes } : {});
  document.getElementById('appointmentSaveContact').checked = !appointment;
  fillAppointmentContactOptions(appointment && appointment.contact_id ? String(appointment.contact_id) : '');
  closeModal('appointmentDetailsModal');
  document.getElementById('appointmentModal').classList.add('active');
  document.getElementById('appointmentTitle').focus();
}

async function writeAppointmentChange(action, reason) {
  if (appointmentWritePending) { toast('Please wait for the save to finish'); return false; }
  appointmentWritePending = true;
  try {
    const before = {
      contacts: db.exec('SELECT * FROM contacts'),
      appointments: db.exec('SELECT * FROM appointments'),
    };
    db.run('BEGIN TRANSACTION');
    try {
      action();
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    try {
      await persist();
    } catch (error) {
      db.run('BEGIN TRANSACTION');
      db.run('DELETE FROM appointments');
      db.run('DELETE FROM contacts');
      restoreAppointmentSnapshot(before);
      db.run('COMMIT');
      throw error;
    }
    await requestChangeBackup(reason);
    return true;
  } catch (error) {
    console.error('Appointment/contact change failed', error);
    toast('Could not save: ' + error.message);
    return false;
  } finally {
    appointmentWritePending = false;
  }
}

async function saveAppointment(event) {
  event.preventDefault();
  if (appointmentSavePending || !document.getElementById('appointmentForm').reportValidity()) return;
  const value = id => document.getElementById(id).value.trim();
  const id = Number(value('appointmentId')) || null;
  const sectionId = Number(value('appointmentSection'));
  const date = value('appointmentDate');
  const start = value('appointmentStart');
  const end = value('appointmentEnd');
  const title = value('appointmentTitle');
  if (!validAppointmentDate(date) || !validAppointmentTime(start) || !validAppointmentTime(end) || end <= start) {
    toast('Choose a valid date and an end time after the start time on the same day.');
    return;
  }
  if (!title) { toast('Appointment title is required'); return; }
  const board = appointmentRows("SELECT id FROM sections WHERE id = ? AND type = 'appointment'", [sectionId])[0];
  if (!board || (id && !getAppointment(id))) { toast('Appointment or board no longer exists'); return; }
  let contactId = Number(value('appointmentContact')) || null;
  const person = contactId ? getContacts().find(contact => contact.id === contactId) : readPersonFields('appointmentPerson');
  if (!person || !person.name) { toast('Person name is required'); return; }
  const conflicts = findAppointmentConflicts(getAppointments(date), { id, date, start_time: start, end_time: end });
  if (conflicts.length && !confirm('This overlaps with:\n' + conflicts.map(other =>
    `${other.start_time} - ${other.end_time}: ${other.title} (${other.board_name})`).join('\n') + '\n\nSave anyway?')) return;
  appointmentSavePending = true;
  document.getElementById('appointmentSaveButton').disabled = true;
  try {
    const saved = await writeAppointmentChange(() => {
      if (!contactId && document.getElementById('appointmentSaveContact').checked) {
        db.run('INSERT INTO contacts (name, phone, email, notes) VALUES (?, ?, ?, ?)',
          [person.name, person.phone, person.email, person.notes]);
        contactId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      }
      const params = [sectionId, contactId, person.name, person.phone, person.email, person.notes,
        title, date, start, end, value('appointmentDescription'), value('appointmentLocation')];
      if (id) {
        db.run(`UPDATE appointments SET section_id = ?, contact_id = ?, person_name = ?, person_phone = ?,
          person_email = ?, person_notes = ?, title = ?, date = ?, start_time = ?, end_time = ?, description = ?, location = ?
          WHERE id = ?`, [...params, id]);
      } else {
        db.run(`INSERT INTO appointments (section_id, contact_id, person_name, person_phone, person_email,
          person_notes, title, date, start_time, end_time, description, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params);
      }
    }, id ? 'appointment-updated' : 'appointment-created');
    if (!saved) return;
    appointmentDay = date;
    appointmentMonth = date.slice(0, 7);
    closeModal('appointmentModal');
    renderSidebar();
    renderMain();
    toast(id ? 'Appointment updated' : 'Appointment created');
  } finally {
    appointmentSavePending = false;
    document.getElementById('appointmentSaveButton').disabled = false;
  }
}

function openAppointmentDetails(id) {
  ensureAppointmentModals();
  const appointment = getAppointment(id);
  if (!appointment) { toast('Appointment no longer exists'); return; }
  document.getElementById('appointmentDetails').innerHTML = `
    <h2 id="appointmentDetailsTitle" dir="auto">${esc(appointment.title)}</h2>
    <p>${esc(appointmentDateLabel(appointment.date))}<br>${appointment.start_time} - ${appointment.end_time}</p>
    <p class="appointment-hint" dir="auto">${esc(appointment.board_name)}</p>
    <h3>Person</h3><div class="appointment-detail-text" dir="auto">${esc(appointment.person_name)}</div>
    ${[appointment.person_phone, appointment.person_email, appointment.person_notes].filter(Boolean)
      .map(value => `<div class="appointment-detail-text" dir="auto">${esc(value)}</div>`).join('')}
    <h3>Description</h3><div class="appointment-detail-text" dir="auto">${esc(appointment.description) || 'No description'}</div>
    ${appointment.location ? `<h3>Location / meeting link</h3><div class="appointment-detail-text" dir="auto">${esc(appointment.location)}</div>` : ''}
    <div class="modal-actions appointment-toolbar">
      <button class="btn btn-ghost" onclick="closeModal('appointmentDetailsModal')">Close</button>
      <button class="btn btn-ghost" onclick="deleteAppointment(${id})">Delete</button>
      <button class="btn btn-ghost" onclick="addAppointmentToCalendar(event, ${id})">&#128197; Add to Calendar</button>
      <button class="btn btn-primary" onclick="openAppointmentModal(${id})">Edit / reschedule</button>
    </div>`;
  document.getElementById('appointmentDetailsModal').classList.add('active');
  document.querySelector('#appointmentDetails button').focus();
}

function addAppointmentToCalendar(event, id) {
  event.stopPropagation();
  const appointment = getAppointment(id);
  if (!appointment) { toast('Appointment no longer exists'); return; }
  downloadCalendarEvent({
    id: `appointment-${id}`,
    title: appointment.title,
    description: [appointment.description, `With: ${appointment.person_name}`,
      appointment.person_phone, appointment.person_email].filter(Boolean).join('\n'),
    start: new Date(`${appointment.date}T${appointment.start_time}:00`),
    end: new Date(`${appointment.date}T${appointment.end_time}:00`),
    location: appointment.location,
  });
}

async function deleteAppointment(id) {
  if (!confirm('Delete this appointment? The saved contact will be kept.')) return;
  if (!await writeAppointmentChange(() => db.run('DELETE FROM appointments WHERE id = ?', [id]), 'appointment-deleted')) return;
  closeModal('appointmentDetailsModal');
  renderSidebar();
  renderMain();
  toast('Appointment deleted');
}

function openContactModal(id = null) {
  ensureAppointmentModals();
  const contact = id === null ? null : getContacts().find(contact => contact.id === id);
  if (id !== null && !contact) { toast('Contact no longer exists'); return; }
  document.getElementById('contactForm').reset();
  document.getElementById('contactId').value = contact ? contact.id : '';
  document.getElementById('contactModalTitle').textContent = contact ? 'Edit contact' : 'Create contact';
  fillPersonFields('contactPerson', contact || {});
  document.getElementById('contactModal').classList.add('active');
  document.getElementById('contactPersonName').focus();
}

async function saveContact(event) {
  event.preventDefault();
  if (contactSavePending || !document.getElementById('contactForm').reportValidity()) return;
  const person = readPersonFields('contactPerson');
  if (!person.name) { toast('Person name is required'); return; }
  const id = Number(document.getElementById('contactId').value) || null;
  if (id && !getContacts().some(contact => contact.id === id)) { toast('Contact no longer exists'); return; }
  contactSavePending = true;
  document.getElementById('contactSaveButton').disabled = true;
  try {
    if (!await writeAppointmentChange(() => {
      const params = [person.name, person.phone, person.email, person.notes];
      if (id) db.run('UPDATE contacts SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?', [...params, id]);
      else {
        db.run('INSERT INTO contacts (name, phone, email, notes) VALUES (?, ?, ?, ?)', params);
      }
    }, id ? 'contact-updated' : 'contact-created')) return;
    closeModal('contactModal');
    renderMain();
    toast(id ? 'Contact updated' : 'Contact created');
  } finally {
    contactSavePending = false;
    document.getElementById('contactSaveButton').disabled = false;
  }
}

function appointmentSnapshotRows(snapshot, key, columns) {
  if (snapshot[key] === undefined) return [];
  const results = snapshot[key];
  if (!Array.isArray(results) || results.length > 1) throw new Error('Invalid ' + key + ' data');
  if (!results.length) return [];
  const result = results[0];
  if (!Array.isArray(result.columns) || result.columns.length !== columns.length ||
      new Set(result.columns).size !== columns.length || !columns.every(column => result.columns.includes(column)) ||
      !Array.isArray(result.values)) throw new Error('Invalid ' + key + ' columns');
  return result.values.map(row => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error('Invalid ' + key + ' row');
    return Object.fromEntries(result.columns.map((column, index) => [column, row[index]]));
  });
}

function validateAppointmentSnapshot(snapshot) {
  const contacts = appointmentSnapshotRows(snapshot, 'contacts', CONTACT_COLUMNS);
  const appointments = appointmentSnapshotRows(snapshot, 'appointments', APPOINTMENT_COLUMNS);
  const validId = id => Number.isSafeInteger(id) && id > 0;
  const contactIds = new Set();
  for (const contact of contacts) {
    if (!validId(contact.id) || contactIds.has(contact.id) ||
        !CONTACT_COLUMNS.slice(1).every(key => typeof contact[key] === 'string') || !contact.name.trim()) {
      throw new Error('Invalid contact');
    }
    contactIds.add(contact.id);
  }
  const sections = snapshot.sections && snapshot.sections[0];
  const sectionIds = new Set(sections && sections.columns ? sections.values
    .filter(row => row[sections.columns.indexOf('type')] === 'appointment')
    .map(row => row[sections.columns.indexOf('id')]) : []);
  const ids = new Set();
  for (const appointment of appointments) {
    if (!validId(appointment.id) || ids.has(appointment.id) || !sectionIds.has(appointment.section_id) ||
        (appointment.contact_id !== null && !contactIds.has(appointment.contact_id)) ||
        !APPOINTMENT_COLUMNS.slice(3).every(key => typeof appointment[key] === 'string') ||
        !appointment.title.trim() || !appointment.person_name.trim() || !validAppointmentDate(appointment.date) ||
        !validAppointmentTime(appointment.start_time) || !validAppointmentTime(appointment.end_time) ||
        appointment.end_time <= appointment.start_time) throw new Error('Invalid appointment');
    ids.add(appointment.id);
  }
}

function restoreAppointmentSnapshot(snapshot) {
  for (const [key, columns] of [['contacts', CONTACT_COLUMNS], ['appointments', APPOINTMENT_COLUMNS]]) {
    for (const row of appointmentSnapshotRows(snapshot, key, columns)) {
      db.run(`INSERT INTO ${key} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        columns.map(column => row[column]));
    }
  }
}
