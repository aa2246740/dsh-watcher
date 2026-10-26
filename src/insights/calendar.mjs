/** Browser-local calendar. The fold runs in the host, so engine.mjs must not import this. */

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Inclusive local dates ending on the day of nowMs. Steps with setDate, not 86400000. */
export function calendarDayKeys(nowMs, count) {
  const n = Math.max(1, Math.floor(count) || 1);
  const cursor = new Date(nowMs);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (n - 1));
  const keys = [];
  for (let i = 0; i < n; i++) {
    keys.push(dayKey(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/** Inclusive local days from earliestMs through nowMs, capped. */
export function calendarSpanDays(earliestMs, nowMs, cap = 365) {
  const cursor = new Date(earliestMs);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(nowMs);
  end.setHours(0, 0, 0, 0);
  const limit = Math.max(1, Math.floor(cap) || 1);
  let n = 1;
  while (cursor < end && n < limit) {
    cursor.setDate(cursor.getDate() + 1);
    n++;
  }
  return n;
}

export function yesterdayKey(nowMs) {
  return calendarDayKeys(nowMs, 2)[0];
}

/** Local midnight of the first day in a window of `days` calendar days ending today. */
export function rangeCutoff(nowMs, days) {
  const n = Math.max(1, Math.floor(days) || 1);
  const cursor = new Date(nowMs);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (n - 1));
  return cursor.getTime();
}

/** New books carry an absolute slot start. Old caches carry a host-local key and no start. */
export function bookDayKey(book) {
  if (book && Number.isFinite(book.start)) return dayKey(book.start);
  if (book && typeof book.key === 'string') return book.key;
  return null;
}
