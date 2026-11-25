/* cleanup.js - the clean-up list: everything marked for uninstall/delete, WHY, what else is affected, and the
 * confirmation state. Nothing is removed without an explicit confirmation of the single item.
 *
 *   state: suggested (tool proposes) -> marked (you want it gone) -> confirmed (you checked what is affected)
 *          -> started (uninstaller / recycle step launched) -> done (gone after a rescan / recycled)
 *          kept (you decided to keep it; stops further proposals)
 *
 * Programs: "marked" is the existing decision "remove" in the software list; the confirmation lives in data/cleanup.json.
 * Files/folders: everything lives in data/cleanup.json (type "path").
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { asArray, fmtBytes } = LC;

  const pathKey = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const STATES = ['suggested', 'marked', 'confirmed', 'started', 'done', 'kept'];
  LC.CLEANUP_STATES = {
    suggested: 'Vorschlag', marked: 'Markiert – zu bestätigen', confirmed: 'Bestätigt – bereit', started: 'Gestartet', done: 'Erledigt', kept: 'Behalten',
  };

  LC.normalizeCleanup = (raw) => {
    const d = raw && typeof raw === 'object' ? raw : {};
    const items = {};
    const src = d.items && typeof d.items === 'object' ? d.items : {};
    for (const [id, v] of Object.entries(src)) {
      if (!v || typeof v !== 'object' || !/^(app|path):/.test(id)) continue;
      items[id] = { ...v, state: STATES.includes(v.state) ? v.state : 'marked' };
    }
    return { version: 1, items };
  };

  /* ------------------------------------------------------------------ document operations (pure; the caller persists) */
  const C = (LC.cleanup = {});
  C.appId = (app) => 'app:' + app.key;
  C.pathId = (p) => 'path:' + pathKey(p);

  C.addPath = (doc, spec, now) => {
    const id = C.pathId(spec.path);
    const old = doc.items[id];
    doc.items[id] = { ...(old || {}), type: 'path', kind: spec.kind === 'file' ? 'file' : 'dir', path: spec.path, name: spec.name || spec.path.split(/[\\/]/).filter(Boolean).pop(), bytes: spec.bytes || 0, reason: spec.reason || '',
      state: old && (old.state === 'confirmed' || old.state === 'started') ? old.state : 'marked', markedAt: (old && old.markedAt) || (now || new Date()).toISOString() };
    return id;
  };
  /** The user confirms one item after looking at what is affected. */
  C.confirm = (doc, item, opts) => {
    opts = opts || {};
    const t = opts.now ? new Date(opts.now) : new Date();
    const id = item.id;
    const base = doc.items[id] || {};
    if (item.type === 'app') {
      doc.items[id] = { ...base, type: 'app', key: item.app.key, rawId: item.app.id, name: item.name, publisher: item.app.publisher || '', bytes: item.bytes || 0 };
    }
    doc.items[id] = { ...doc.items[id], state: 'confirmed', confirmedAt: t.toISOString(), confirmedMs: t.getTime(), ack: !!opts.ack, note: opts.note || base.note || '' };
    return doc.items[id];
  };
  C.revoke = (doc, id) => { if (doc.items[id]) { if (doc.items[id].type === 'path') doc.items[id].state = 'marked'; else delete doc.items[id]; } };
  C.started = (doc, id, now) => { if (doc.items[id]) { doc.items[id].state = 'started'; doc.items[id].startedAt = (now || new Date()).toISOString(); } };
  C.done = (doc, id, now) => { if (doc.items[id]) { doc.items[id].state = 'done'; doc.items[id].doneAt = (now || new Date()).toISOString(); } };
  C.keep = (doc, item, now) => { doc.items[item.id] = { ...(doc.items[item.id] || {}), type: item.type, name: item.name, path: item.path, kind: item.kind, bytes: item.bytes || 0, state: 'kept', keptAt: (now || new Date()).toISOString() }; };
  C.drop = (doc, id) => { delete doc.items[id]; };

  /* ------------------------------------------------------------------ app candidates */
  const REMOVAL_TAGS = new Set(['pup', 'eol', 'dup', 'unused']);
  const REASON_TAGS = new Set(['user-remove', 'pup', 'eol', 'eol-soon', 'dup', 'unused', 'rare', 'notrace', 'ever', 'startup', 'bloat', 'big-game', 'unknown-program']);

  function appReasons(a) {
    const out = [];
    for (const r of a.reco.reasons) {
      if (!REASON_TAGS.has(r.tag)) continue;
      out.push({ by: r.tag === 'user-remove' ? 'du' : 'tool', level: r.level, tag: r.tag, text: r.text });
    }
    if (a.note) out.push({ by: 'du', level: 'info', tag: 'note', text: 'Deine Notiz: ' + a.note });
    if (a.purpose) out.push({ by: 'du', level: 'info', tag: 'purpose', text: 'Du nutzt es für: ' + a.purpose });
    return out;
  }
  const isCandidate = (a) => !a.isSystemComponent && !a.flags.includes('keep') && a.decision !== 'keep' && a.reco.reasons.some((r) => REMOVAL_TAGS.has(r.tag));

  function makeAppItem(a, ix, state, rec) {
    const prot = ix.kb.get(a.key) && ix.kb.get(a.key).protect;
    return {
      id: C.appId(a), type: 'app', kind: 'app', name: a.name, subtitle: [a.publisher, a.version].filter(Boolean).join(' · '), app: a, bytes: a.sizeKB ? a.sizeKB * 1024 : 0, bytesApprox: a.sizeApprox,
      reasons: appReasons(a), level: a.reco.level === 'ok' ? 'info' : a.reco.level, state, rec: rec || null, protect: !!prot,
      confirmedAt: rec ? rec.confirmedAt : null, startedAt: rec ? rec.startedAt : null,
      canUninstall: a.source === 'registry' && !!a.uninstallString, via: a.source === 'store' ? 'store' : 'classic',
    };
  }

  /**
   * An item for ANY installed program (used by the "Deinstallieren" button in the program details): same reasons and
   * affected-objects list as on the clean-up page, as if the program were already on the list.
   */
  C.itemForApp = (a, ix, doc) => {
    const item = makeAppItem(a, ix, 'marked', doc && doc.items[C.appId(a)]);
    if (!item.reasons.some((r) => r.tag === 'user-remove')) item.reasons.unshift({ by: 'du', level: 'warn', tag: 'user-remove', text: 'Von dir im Detailfenster zum Deinstallieren gewählt.' });
    item.rel = LC.relationsOfApp(a, ix, { removing: new Set([...ix.removing, a.key]) });
    return item;
  };

  /* ------------------------------------------------------------------ main */
  /**
   * @param ctx { inv, doc (normalised), ix (relation index), filesModel, filesRaw, now }
   */
  LC.buildCleanup = (ctx) => {
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const doc = ctx.doc || LC.normalizeCleanup(null);
    const ix = ctx.ix;
    const items = [];
    const appKeys = new Set(ctx.inv.apps.map((a) => a.key));

    for (const a of ctx.inv.apps) {
      const id = C.appId(a);
      const rec = doc.items[id];
      const marked = a.decision === 'remove';
      const suggested = !marked && isCandidate(a);
      if (!marked && !suggested) continue;
      let state = marked ? 'marked' : 'suggested';
      if (marked && rec && (rec.state === 'confirmed' || rec.state === 'started')) state = rec.state;
      items.push(makeAppItem(a, ix, state, rec));
    }
    // programs that are gone since they were confirmed / started
    for (const [id, rec] of Object.entries(doc.items)) {
      if (rec.type !== 'app' || !rec.key || appKeys.has(rec.key)) continue;
      if (rec.state !== 'confirmed' && rec.state !== 'started' && rec.state !== 'done') continue;
      items.push({ id, type: 'app', kind: 'app', name: rec.name || rec.key, subtitle: rec.publisher || '', app: null, bytes: rec.bytes || 0, reasons: [], level: 'info', state: 'done', rec, doneAt: rec.doneAt || null, confirmedAt: rec.confirmedAt, startedAt: rec.startedAt });
    }

    // files / folders the user marked or confirmed
    const seenPaths = new Set();
    for (const [id, rec] of Object.entries(doc.items)) {
      if (rec.type !== 'path') continue;
      seenPaths.add(pathKey(rec.path));
      if (rec.state === 'kept') continue;
      items.push({ id, type: 'path', kind: rec.kind || 'dir', name: rec.name, subtitle: rec.path, path: rec.path, bytes: rec.bytes || 0,
        reasons: [{ by: 'du', level: 'info', tag: 'user', text: rec.reason || 'Von dir zur Aufräumliste hinzugefügt.' }], level: 'info', state: rec.state, rec, confirmedAt: rec.confirmedAt, startedAt: rec.startedAt, doneAt: rec.doneAt });
    }
    // suggestions from the files scan
    const suggestPath = (spec, reason, level) => {
      const k = pathKey(spec.path);
      if (seenPaths.has(k)) return;
      const kept = doc.items[C.pathId(spec.path)];
      if (kept && kept.state === 'kept') return;
      seenPaths.add(k);
      items.push({ id: C.pathId(spec.path), type: 'path', kind: spec.kind, name: spec.name, subtitle: spec.path, path: spec.path, bytes: spec.bytes || 0, reasons: [{ by: 'tool', level: level || 'info', tag: spec.tag, text: reason }], level: level || 'info', state: 'suggested', rec: null });
    };
    const fm = ctx.filesModel;
    if (fm) {
      for (const c of fm.candidates) {
        if (c.depth === 1 && c.suggestion.action === 'delete' && c.localBytes >= 50 * 1024 * 1024) suggestPath({ path: c.path, kind: 'dir', name: c.name, bytes: c.localBytes, tag: 'installers' }, c.suggestion.reason + ' (' + fmtBytes(c.localBytes) + ')');
      }
      for (const d of fm.localCloudDupes.slice().sort((x, y) => y.size - x.size).slice(0, 20)) {
        const roots = fm.cloudRoots.map((r) => r.path);
        const localCopies = asArray(d.paths).filter((p) => !roots.some((r) => LC.pathUnder(p, r)));
        if (localCopies.length && d.size >= 20 * 1024 * 1024) suggestPath({ path: localCopies[0], kind: 'file', name: d.name, bytes: d.size, tag: 'cloud-dupe' }, 'Dieselbe Datei (Name + Größe) liegt schon in der Cloud – die lokale Kopie ist ersetzbar.');
      }
      for (const r of fm.repos) {
        if (r.nodeModulesBytes >= 300 * 1024 * 1024 && (r.lastCommitDays == null || r.lastCommitDays > 60) && !r.dirty) {
          suggestPath({ path: r.path.replace(/[\\/]+$/, '') + LC.sepOf(r.path) + 'node_modules', kind: 'dir', name: r.name + ' / node_modules', bytes: r.nodeModulesBytes, tag: 'node-modules' }, 'node_modules von „' + r.name + '“ – seit ' + (r.lastCommitDays == null ? 'langem' : r.lastCommitDays + ' Tagen') + ' nicht mehr bearbeitet; „npm ci“ baut es jederzeit neu auf.');
        }
      }
    }
    // leftovers of well-known programs that are no longer installed
    for (const d of asArray(ix.dataDirs)) {
      if (d.bytes < 50 * 1024 * 1024) continue;
      const entry = LC.RELATIONS.find((e) => (e.data || []).some((re) => re.test(d.name)) && !e.sharedData);
      if (!entry || ix.apps.some((a) => entry.re.test(a.name))) continue;
      const label = entry.id.replace(/^./, (c) => c.toUpperCase());
      suggestPath({ path: d.path, kind: 'dir', name: d.name, bytes: d.bytes, tag: 'leftover' }, 'Programmdaten von „' + label + '“ – das Programm selbst ist nicht (mehr) installiert (' + fmtBytes(d.bytes) + ').');
    }

    // relations (what else is affected)
    for (const it of items) {
      if (it.state === 'done') { it.rel = null; continue; }
      it.rel = it.type === 'app' ? LC.relationsOfApp(it.app, ix) : LC.relationsOfPath({ path: it.path, kind: it.kind, bytes: it.bytes }, ix);
    }
    const order = { confirmed: 0, started: 1, marked: 2, suggested: 3, done: 4 };
    items.sort((a, b) => (order[a.state] - order[b.state]) || (b.bytes - a.bytes));
    const by = {};
    STATES.forEach((s) => { by[s] = items.filter((i) => i.state === s); });
    const pending = by.marked.concat(by.confirmed, by.started);
    const model = {
      items, by,
      totals: {
        marked: by.marked.length, confirmed: by.confirmed.length, started: by.started.length, suggested: by.suggested.length, done: by.done.length,
        pendingBytes: pending.reduce((s, i) => s + (i.bytes || 0), 0),
        suggestedBytes: by.suggested.reduce((s, i) => s + (i.bytes || 0), 0),
        leftoverBytes: pending.reduce((s, i) => s + (i.rel ? i.rel.summary.leftoverBytes : 0), 0),
        orphanBytes: pending.reduce((s, i) => s + (i.rel ? i.rel.summary.orphanBytes : 0), 0),
      },
    };
    model.findings = buildCleanupFindings(model, now);
    return model;
  };

  /* ------------------------------------------------------------------ findings */
  function buildCleanupFindings(m, now) {
    const F = [];
    const add = (f) => F.push({ area: 'cleanup', severity: 'info', detail: '', action: '', steps: [], links: [], task: null, impact: 2, ...f });
    const t = m.totals;
    if (t.marked) {
      add({ id: 'cleanup.confirm', severity: 'info', task: true, impact: 3, title: t.marked + ' ' + LC.plural(t.marked, 'Objekt wartet', 'Objekte warten') + ' auf deine Bestätigung zum Entfernen',
        detail: m.by.marked.slice(0, 5).map((i) => i.name).join(', ') + (t.marked > 5 ? ' …' : '') + '. Zusammen ' + fmtBytes(m.by.marked.reduce((s, i) => s + i.bytes, 0)) + '. Vor der Bestätigung zeigt LaptopCheck, was sonst noch betroffen ist.',
        action: 'Unter „Aufräumen“ jedes Objekt prüfen und bestätigen – oder von der Liste nehmen.' });
    }
    if (t.confirmed) {
      add({ id: 'cleanup.confirmed', severity: 'info', task: true, impact: 3, title: t.confirmed + ' bestätigte(s) Objekt(e) ' + LC.plural(t.confirmed, 'ist', 'sind') + ' noch nicht entfernt',
        detail: m.by.confirmed.slice(0, 5).map((i) => i.name).join(', ') + '.', action: 'Unter „Aufräumen“ auf „Entfernen starten“ klicken.' });
    }
    for (const i of m.by.started) {
      const days = i.startedAt ? LC.daysBetween(i.startedAt, now) : 0;
      if (days >= 1) add({ id: 'cleanup.started:' + i.id, severity: 'info', task: true, impact: 2, title: '„' + i.name + '“: Entfernen vor ' + days + ' Tag(en) gestartet – wurde es abgeschlossen?', detail: 'Neu scannen zeigt, ob es verschwunden ist.', action: 'Neu scannen (Dateien bzw. Programme).' });
    }
    if (t.orphanBytes > 0 || m.items.some((i) => i.rel && i.rel.summary.orphan > 0 && ['marked', 'confirmed'].includes(i.state))) {
      const lines = m.items.filter((i) => ['marked', 'confirmed'].includes(i.state) && i.rel).flatMap((i) => i.rel.groups.flatMap((g) => g.items.filter((x) => x.impact === 'orphan').map((x) => x.title + ' (wegen ' + i.name + ')')));
      if (lines.length) add({ id: 'cleanup.orphans', severity: 'info', task: true, impact: 2, title: lines.length + ' Begleit-Objekt(e) sind nach dem Entfernen vermutlich überflüssig', detail: lines.slice(0, 5).join('; ') + '.', action: 'Unter „Aufräumen“ bei dem jeweiligen Objekt „Auch entfernen?“ ansehen.' });
    }
    if (t.suggested) {
      add({ id: 'cleanup.suggestions', severity: 'info', task: true, impact: 2, title: t.suggested + ' ' + LC.plural(t.suggested, 'Vorschlag', 'Vorschläge') + ' zum Aufräumen' + (t.suggestedBytes ? ' (bis zu ' + fmtBytes(t.suggestedBytes) + ')' : ''),
        detail: m.by.suggested.slice(0, 5).map((i) => i.name).join(', ') + (t.suggested > 5 ? ' …' : '') + '.', action: 'Unter „Aufräumen → Vorschläge“ ansehen: übernehmen oder „Behalten“.' });
    }
    return F;
  }
})(typeof window !== 'undefined' ? window : globalThis);
