// Read private activity directly from owner-only audit documents.
// Never copy it to the public manual list or browser localStorage.
(function () {
  const status = document.getElementById('sherlockActivityStatus');
  const table = document.getElementById('sherlockActivityTable');
  const body = document.getElementById('sherlockActivityBody');
  let revision = 0;

  function activityRows(activity) {
    return Array.isArray(activity?.slgs)
      ? activity.slgs.filter(row => /^\d+$/.test(row.id)) : [];
  }

  async function emailText(dayKey, store) {
    if (!store.configured || !store.canEdit()) {
      throw new Error('Sign in as the planner owner to include your Sherlock post activity.');
    }
    const doc = await store.getAudit(dayKey);
    if (!store.canEdit()) throw new Error('Please sign in again to include your Sherlock post activity.');
    const heading = `SLGs you posted on — ${dayKey}`;
    if (!Array.isArray(doc?.ts360?.slgs)) {
      return `${heading}\nNo TS360 activity has been imported for this day.`;
    }
    const rows = activityRows(doc.ts360);
    if (!rows.length) return `${heading}\nNo SLGs in the imported activity for this day.`;
    const cell = value => String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '/').trim();
    return [heading, '', 'Sherlock | Customer', '---------|---------', ...rows.map(row =>
      `SLG ${row.id}${row.title ? ' — ' + cell(row.title) : ''} | ${cell(row.customer)}`
    )].join('\n');
  }

  function clear() {
    revision++;
    body.replaceChildren();
    table.hidden = true;
    status.textContent = 'Sign in as the planner owner to see your TS360 post activity.';
  }

  async function load(dayKey, store) {
    clear();
    const request = revision;
    if (!store.configured || !store.canEdit()) return;
    status.textContent = `Loading your posts for ${dayKey}…`;
    try {
      const doc = await store.getAudit(dayKey);
      if (request !== revision || !store.canEdit()) return;
      const activity = doc?.ts360;
      if (!activity || !Array.isArray(activity.slgs)) {
        status.textContent = `No TS360 activity has been imported for ${dayKey}. Only recent posts are available from TS360; missing history does not mean you made no posts.`;
        return;
      }
      const rows = activityRows(activity);
      for (const row of rows) {
        const tr = document.createElement('tr');
        const slg = document.createElement('td');
        const link = document.createElement('a');
        link.href = `https://sherlock.epic.com/default.aspx?view=slg/home#id=${row.id}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `SLG ${row.id}`;
        slg.append(link, document.createElement('br'), document.createTextNode(row.title || ''));
        const detail = document.createElement('td');
        detail.textContent = row.customer || '';
        tr.append(slg, detail);
        body.append(tr);
      }
      const fetched = new Date(activity.fetchedAt);
      const stamp = Number.isNaN(fetched.getTime()) ? '' : ` Updated ${fetched.toLocaleString()}.`;
      status.textContent = `${dayKey} · ${rows.length} SLG${rows.length === 1 ? '' : 's'} · TS360 post activity (published and internal).${stamp}`;
      table.hidden = rows.length === 0;
    } catch (_) {
      if (request !== revision) return;
      status.textContent = 'Could not load TS360 activity. Check your sign-in or connection, then reload the planner.';
    }
  }
  window.sherlockActivity = {load, clear, emailText};
})();
