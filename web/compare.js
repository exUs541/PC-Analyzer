/* compare.js - "Ordner vergleichen": turns the result of POST /api/compare into what the page shows.
 *
 *   LC.compareModel(raw)             -> { s, nameA, nameB, verdict, tree, cards, ... }   (raw = the server's result)
 *   LC.compareRows(model, kind, q)   -> the rows of one list ('onlyA' | 'onlyB' | 'changed' | 'moved'), filtered by a text
 *   LC.compareCsv(model)             -> every difference as CSV text
 *
 * Reading only: nothing here changes a file. A = the first folder, B = the second.
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});
  const { asArray, fmtBytes } = LC;

  const lastSeg = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');
  const plural = (n, one, many) => (n === 1 ? one : many);

  /** Short names for the two folders: the last part of the path; when both are called the same, the parent is added. */
  LC.compareNames = (a, b) => {
    const na = lastSeg(a), nb = lastSeg(b);
    if (na.toLowerCase() !== nb.toLowerCase()) return [na, nb];
    const up = (p) => { const parts = String(p).replace(/[\\/]+$/, '').split(/[\\/]/); return parts.slice(-2).join('\\'); };
    return [up(a), up(b)];
  };

  const cnt = (o) => ({ n: (o && o.files) || 0, bytes: (o && o.bytes) || 0 });

  function buildTree(dirs) {
    const nodes = new Map();
    const root = { d: '', name: '', kids: [] };
    nodes.set('', root);
    const get = (d) => {
      if (nodes.has(d)) return nodes.get(d);
      const i = d.lastIndexOf('\\');
      const parent = get(i < 0 ? '' : d.slice(0, i));
      const n = { d, name: i < 0 ? d : d.slice(i + 1), kids: [] };
      parent.kids.push(n);
      nodes.set(d, n);
      return n;
    };
    for (const r of dirs) {
      const n = get(r.d);
      n.same = cnt(r.same); n.onlyA = cnt(r.onlyA); n.onlyB = cnt(r.onlyB); n.changed = cnt(r.changed); n.moved = cnt(r.moved);
    }
    const weight = (n) => (n.onlyA ? n.onlyA.bytes + n.onlyB.bytes + n.changed.bytes + n.moved.bytes : 0);
    const diffN = (n) => (n.onlyA ? n.onlyA.n + n.onlyB.n + n.changed.n + n.moved.n : 0);
    const sort = (n) => { n.kids.sort((x, y) => weight(y) - weight(x) || diffN(y) - diffN(x) || x.name.localeCompare(y.name)); n.kids.forEach(sort); };
    sort(root);
    return root;
  }

  LC.compareModel = (raw) => {
    if (!raw || !raw.summary) return null;
    const S = raw.summary;
    const s = { filesA: S.filesA, bytesA: S.bytesA, filesB: S.filesB, bytesB: S.bytesB, same: cnt(S.same), changed: cnt(S.changed), moved: cnt(S.moved), onlyA: cnt(S.onlyA), onlyB: cnt(S.onlyB), ignored: S.ignored || 0, unverified: S.unverified || 0 };
    const [nameA, nameB] = LC.compareNames(raw.a, raw.b);
    const different = s.onlyA.n + s.onlyB.n + s.changed.n;
    const movedOnly = s.moved.n;

    // the answer in one sentence
    let sev, title, text;
    if (different === 0 && movedOnly === 0) {
      sev = 'ok'; title = 'Die Ordner sind gleich';
      text = s.same.n + ' ' + plural(s.same.n, 'Datei liegt', 'Dateien liegen') + ' in beiden Ordnern, mit demselben Pfad und derselben Größe' + (raw.deep ? ' und demselben Inhalt' : '') + '.';
    } else if (s.onlyA.n === 0 && s.changed.n === 0) {
      sev = movedOnly ? 'info' : 'ok';
      title = 'Alles aus „' + nameA + '“ ist auch in „' + nameB + '“';
      text = (s.onlyB.n ? '„' + nameB + '“ hat zusätzlich ' + s.onlyB.n + ' ' + plural(s.onlyB.n, 'Datei', 'Dateien') + ' (' + fmtBytes(s.onlyB.bytes) + '). ' : '') + (movedOnly ? movedOnly + ' ' + plural(movedOnly, 'Datei liegt', 'Dateien liegen') + ' dort an einer anderen Stelle (verschoben oder umbenannt). ' : '');
    } else if (s.onlyB.n === 0 && s.changed.n === 0) {
      sev = movedOnly ? 'info' : 'ok';
      title = 'Alles aus „' + nameB + '“ ist auch in „' + nameA + '“';
      text = '„' + nameA + '“ hat zusätzlich ' + s.onlyA.n + ' ' + plural(s.onlyA.n, 'Datei', 'Dateien') + ' (' + fmtBytes(s.onlyA.bytes) + '). ' + (movedOnly ? movedOnly + ' ' + plural(movedOnly, 'Datei liegt', 'Dateien liegen') + ' in „' + nameB + '“ an einer anderen Stelle. ' : '');
    } else {
      sev = 'warn'; title = 'Die Ordner unterscheiden sich';
      text = [s.onlyA.n ? s.onlyA.n + ' nur in „' + nameA + '“ (' + fmtBytes(s.onlyA.bytes) + ')' : '', s.onlyB.n ? s.onlyB.n + ' nur in „' + nameB + '“ (' + fmtBytes(s.onlyB.bytes) + ')' : '',
        s.changed.n ? s.changed.n + ' in beiden, aber verschieden' : '', movedOnly ? movedOnly + ' verschoben oder umbenannt' : ''].filter(Boolean).join(' · ') + '.';
    }
    const notes = [];
    if (raw.partial) notes.push('Der Vergleich wurde wegen der Zeitgrenze abgebrochen: Die Zahlen sind Mindestwerte.');
    if (s.unverified) notes.push(s.unverified + ' ' + plural(s.unverified, 'Datei konnte', 'Dateien konnten') + ' nicht auf den Inhalt geprüft werden (zu groß oder nicht lesbar).');
    if (s.ignored) notes.push(s.ignored + ' ' + plural(s.ignored, 'Verknüpfung oder Hilfsdatei', 'Verknüpfungen und Hilfsdateien') + ' (desktop.ini, .gdoc …) nicht mitgezählt.');
    if (!raw.deep && s.same.n) notes.push('„Gleich“ heißt: gleicher Pfad und gleiche Größe. Mit „Inhalt prüfen“ werden die Dateien auch gelesen und verglichen.');

    const cards = [
      { id: 'same', label: 'Gleich', n: s.same.n, bytes: s.same.bytes, sub: 'in beiden Ordnern', cls: 'g1', view: null },
      { id: 'onlyA', label: 'Nur in „' + nameA + '“', n: s.onlyA.n, bytes: s.onlyA.bytes, sub: 'fehlt in „' + nameB + '“', cls: 'g2', view: 'onlyA' },
      { id: 'onlyB', label: 'Nur in „' + nameB + '“', n: s.onlyB.n, bytes: s.onlyB.bytes, sub: 'fehlt in „' + nameA + '“', cls: 'g3', view: 'onlyB' },
      { id: 'changed', label: 'Verschieden', n: s.changed.n, bytes: s.changed.bytes, sub: 'in beiden, aber nicht gleich', cls: 'g4', view: 'changed' },
      { id: 'moved', label: 'Verschoben', n: s.moved.n, bytes: s.moved.bytes, sub: 'nur an anderer Stelle', cls: 'g5', view: 'moved' },
    ];
    return {
      raw, s, nameA, nameB, a: raw.a, b: raw.b, deep: !!raw.deep, verdict: { sev, title, text: text.trim() }, notes, cards,
      tree: buildTree(asArray(raw.dirs)),
      cut: { onlyA: !!raw.cutOnlyA, onlyB: !!raw.cutOnlyB, changed: !!raw.cutChanged, moved: !!raw.cutMoved, dirs: !!raw.cutDirs },
      scannedAt: raw.scannedAt, seconds: raw.seconds,
    };
  };

  const dirOf = (rel) => { const i = String(rel).lastIndexOf('\\'); return i < 0 ? '' : String(rel).slice(0, i); };
  const fileOf = (rel) => String(rel).slice(String(rel).lastIndexOf('\\') + 1);

  /** The rows of one list, filtered by text (path, case-insensitive). */
  LC.compareRows = (m, kind, q) => {
    const needle = String(q || '').trim().toLowerCase();
    const src = asArray(m.raw[kind]);
    const rows = src.map((x) => (kind === 'moved'
      ? { key: x.a + '>' + x.b, a: x.a, b: x.b, size: x.s, dirA: dirOf(x.a), nameA: fileOf(x.a), dirB: dirOf(x.b), nameB: fileOf(x.b) }
      : kind === 'changed'
        ? { key: x.p, p: x.p, dir: dirOf(x.p), name: fileOf(x.p), sa: x.sa, sb: x.sb, ma: x.ma, mb: x.mb, why: x.why, newer: x.ma > x.mb ? 'A' : x.mb > x.ma ? 'B' : null }
        : { key: x.p, p: x.p, dir: dirOf(x.p), name: fileOf(x.p), size: x.s, m: x.m }));
    return needle ? rows.filter((r) => (kind === 'moved' ? r.a + ' ' + r.b : r.p).toLowerCase().includes(needle)) : rows;
  };

  /** Every difference as CSV (semicolon: German Excel). */
  LC.compareCsv = (m) => {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Art', 'Pfad in ' + m.nameA, 'Pfad in ' + m.nameB, 'Größe ' + m.nameA + ' (Byte)', 'Größe ' + m.nameB + ' (Byte)', 'Geändert ' + m.nameA, 'Geändert ' + m.nameB].map(q).join(';')];
    for (const x of asArray(m.raw.onlyA)) lines.push(['Nur in ' + m.nameA, x.p, '', x.s, '', x.m, ''].map(q).join(';'));
    for (const x of asArray(m.raw.onlyB)) lines.push(['Nur in ' + m.nameB, '', x.p, '', x.s, '', x.m].map(q).join(';'));
    for (const x of asArray(m.raw.changed)) lines.push(['Verschieden (' + (x.why === 'content' ? 'Inhalt' : 'Größe') + ')', x.p, x.p, x.sa, x.sb, x.ma, x.mb].map(q).join(';'));
    for (const x of asArray(m.raw.moved)) lines.push(['Verschoben', x.a, x.b, x.s, x.s, '', ''].map(q).join(';'));
    return '﻿' + lines.join('\r\n');
  };
})(typeof window !== 'undefined' ? window : globalThis);
