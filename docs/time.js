// Time helpers shared by the site (and tested in Node).

export function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

// Accepts "1:02:03", "62:03", "3723", "3723.5". Returns seconds, or NaN if invalid.
export function parse(v) {
  v = String(v ?? "").trim();
  if (!v) return NaN;
  if (/^\d+(\.\d+)?$/.test(v)) return +v;
  const parts = v.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  const n = parts.map(Number);
  if (n.slice(1).some(x => x >= 60)) return NaN;
  return n.reduce((acc, x) => acc * 60 + x, 0);
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
