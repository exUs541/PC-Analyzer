/* util.js - small helpers shared by all dashboard modules (namespace LC). */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});

  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  LC.GB = GB;
  LC.MB = MB;

  LC.asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  LC.num = (x) => (x == null || x === '' || Number.isNaN(+x) ? null : +x);
  LC.clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  LC.sum = (arr, f) => arr.reduce((a, b) => a + (f ? f(b) : b) || 0, 0);

  const nf = (d) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const nf1 = nf(1);
  const nf0 = nf(0);
  const nf2 = nf(2);
  LC.fmtNum = (x, digits = 1) => (x == null ? '–' : (digits === 0 ? nf0 : digits === 2 ? nf2 : nf1).format(x));

  /** Windows-style sizes (1024-based, labelled GB/TB like Windows does). */
  LC.fmtBytes = (b) => {
    if (b == null || Number.isNaN(+b)) return '–';
    const v = +b;
    if (v >= 1024 ** 4) return nf1.format(v / 1024 ** 4) + ' TB';
    if (v >= GB) return nf1.format(v / GB) + ' GB';
    if (v >= MB) return nf0.format(v / MB) + ' MB';
    if (v >= 1024) return nf0.format(v / 1024) + ' KB';
    return nf0.format(v) + ' B';
  };
  LC.fmtKB = (kb) => (kb == null ? '–' : LC.fmtBytes(kb * 1024));

  LC.parseDate = (s) => {
    if (!s) return null;
    const d = s instanceof Date ? s : new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  LC.fmtDate = (s) => {
    const d = LC.parseDate(s);
    if (!d) return '–';
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  LC.fmtDateTime = (s) => {
    const d = LC.parseDate(s);
    if (!d) return '–';
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  LC.toDateInput = (s) => {
    const d = LC.parseDate(s);
    if (!d) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  LC.daysBetween = (from, to) => {
    const a = LC.parseDate(from);
    const b = LC.parseDate(to);
    if (!a || !b) return null;
    return Math.floor((b.getTime() - a.getTime()) / 86400000);
  };
  LC.fmtAgo = (days) => {
    if (days == null) return '';
    if (days < 0) return 'in der Zukunft';
    if (days === 0) return 'heute';
    if (days === 1) return 'gestern';
    if (days < 14) return 'vor ' + days + ' Tagen';
    if (days < 60) return 'vor ' + Math.round(days / 7) + ' Wochen';
    if (days < 700) return 'vor ' + Math.round(days / 30.4) + ' Monaten';
    return 'vor ' + nf1.format(days / 365.25) + ' Jahren';
  };

  LC.plural = (n, one, many) => (n === 1 ? one : many);

  /** Normalise free text for matching: lower case, no accents/punctuation noise. */
  LC.norm = (s) =>
    String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[(){}\[\]"'’™®©]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  LC.compact = (s) => LC.norm(s).replace(/[^a-z0-9+#]/g, '');

  LC.csv = (rows, sep) => {
    sep = sep || ';';
    const esc = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // neutralise spreadsheet formulas
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '\ufeff' + rows.map((r) => r.map(esc).join(sep)).join('\r\n');
  };

  LC.debounce = (fn, ms) => { let t = null; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  LC.searchUrl = (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q);
})(typeof window !== 'undefined' ? window : globalThis);
