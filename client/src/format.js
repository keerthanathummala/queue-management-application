/** "45 s", "4 min", "1 h 12 min" */
export function formatMinutes(min) {
  if (min === null || min === undefined || Number.isNaN(min)) return '—';
  if (min < 1) return `${Math.max(0, Math.round(min * 60))} s`;
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const minutesSince = (iso, now = Date.now()) => (now - new Date(iso).getTime()) / 60000;

export const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function formatHour(h) {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric' });
}
