import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'vitest';

const engineHref = new URL('../src/insights/engine.mjs', import.meta.url).href;
const calendarHref = new URL('../src/insights/calendar.mjs', import.meta.url).href;
const SLOT_MS = 15 * 60 * 1000;

function runInTz(tz, code) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function foldDays(tz, times) {
  return runInTz(tz, `
    import { initialState, reduceEvent } from ${JSON.stringify(engineHref)};
    const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, reasoningTokens: 3, totalTokens: 35 };
    const event = (type, seq, time, data = {}) => ({ type, seq, time, data });
    const times = ${JSON.stringify(times)};
    const events = [event('request/header', 0, times[0] - 3, { header: { config: { provider: 'p', model: 'a' } } })];
    times.forEach((time, i) => {
      const seq = 1 + i * 4;
      const turn = i + 1;
      events.push(
        event('turn/start', seq, time - 2, { turn }),
        event('step/start', seq + 1, time - 1, { turn, step: 1 }),
        event('assistant/message', seq + 2, time, { turn, step: 1, usage, message: { source: { kind: 'model', provider: 'p', model: 'a' }, role: 'assistant', content: [] } }),
        event('turn/end', seq + 3, time + 1, { turn }),
      );
    });
    const once = events.reduce(reduceEvent, initialState({ id: 's' }));
    const twice = events.reduce(reduceEvent, once);
    process.stdout.write(JSON.stringify({ days: once.days, tokens: once.totals.tokens, replayTokens: twice.totals.tokens, replayDays: twice.days }));
  `);
}

function place(tz, books) {
  return runInTz(tz, `
    import { bookDayKey } from ${JSON.stringify(calendarHref)};
    const books = ${JSON.stringify(books)};
    process.stdout.write(JSON.stringify(books.map(bookDayKey)));
  `);
}

function localInstant(tz, y, month, day, hour, minute) {
  return runInTz(tz, `
    process.stdout.write(JSON.stringify({ ms: new Date(${y}, ${month - 1}, ${day}, ${hour}, ${minute}, 0).getTime() }));
  `).ms;
}

test('the fold does not format a host-local calendar day', () => {
  const source = readFileSync(new URL('../src/insights/engine.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getFullYear|getMonth|getDate|getTimezoneOffset/);
});

test('UTC and Shanghai hosts record the same quarter-hour buckets', () => {
  // 2026-10-26 01:00 in Asia/Shanghai, still 2026-10-25 in UTC. 10:00 Shanghai is the UTC next day.
  const morning = Date.UTC(2026, 9, 25, 17, 0, 0);
  const later = Date.UTC(2026, 9, 26, 2, 0, 0);
  const utc = foldDays('UTC', [morning, later]);
  const shanghai = foldDays('Asia/Shanghai', [morning, later]);
  assert.deepEqual(utc.days, shanghai.days);
  assert.equal(utc.days.length, 2);
  assert.deepEqual(utc.days.map(d => d.start), [Math.floor(morning / SLOT_MS) * SLOT_MS, Math.floor(later / SLOT_MS) * SLOT_MS]);
  assert.deepEqual(utc.days.map(d => d.tokens), [35, 35]);
  assert.equal(utc.tokens, 70);
  assert.equal(utc.replayTokens, 70);
  assert.deepEqual(utc.replayDays, utc.days);
  assert.deepEqual(place('Asia/Shanghai', utc.days), ['2026-10-26', '2026-10-26']);
  assert.deepEqual(place('UTC', utc.days), ['2026-10-25', '2026-10-26']);
});

test('quarter-hour buckets split local midnights that 30 minutes would glue together', () => {
  for (const tz of ['Asia/Kathmandu', 'Australia/Eucla', 'Pacific/Chatham']) {
    const late = localInstant(tz, 2026, 6, 14, 23, 50);
    const early = localInstant(tz, 2026, 6, 15, 0, 10);
    const folded = foldDays('UTC', [late, early]);
    assert.equal(folded.days.length, 2, tz);
    assert.equal(folded.days[1].start - folded.days[0].start, SLOT_MS, tz);
    assert.deepEqual(place(tz, folded.days), ['2026-06-14', '2026-06-15'], tz);
    assert.deepEqual(folded.days, foldDays(tz, [late, early]).days, tz);
  }
});

test('the chart day list steps local midnights across New York DST', () => {
  const got = runInTz('America/New_York', `
    import { calendarDayKeys, yesterdayKey, rangeCutoff, dayKey } from ${JSON.stringify(calendarHref)};
    const spring = new Date(2026, 2, 9, 0, 30, 0).getTime();
    const fall = new Date(2026, 10, 1, 23, 30, 0).getTime();
    const springKeys = calendarDayKeys(spring, 3);
    const fallKeys = calendarDayKeys(fall, 3);
    process.stdout.write(JSON.stringify({
      springKeys,
      springYesterday: yesterdayKey(spring),
      springCutoff: dayKey(rangeCutoff(spring, 3)),
      fallKeys,
      fallUnique: new Set(fallKeys).size,
    }));
  `);
  // Subtracting 86400000 at 00:30 the morning after the spring-forward skips 2026-03-08.
  assert.deepEqual(got.springKeys, ['2026-03-07', '2026-03-08', '2026-03-09']);
  assert.equal(got.springYesterday, '2026-03-08');
  assert.equal(got.springCutoff, '2026-03-07');
  // At 23:30 on the fall-back day, subtracting 86400000 repeats 2026-11-01 and drops 2026-10-30.
  assert.deepEqual(got.fallKeys, ['2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(got.fallUnique, 3);
});

test('a legacy day key is not reinterpreted, and a missing book has no day', async () => {
  const { bookDayKey, calendarDayKeys, calendarSpanDays, dayKey, rangeCutoff, yesterdayKey } = await import('../src/insights/calendar.mjs');
  const now = Date.UTC(2026, 5, 15, 12, 0, 0);
  assert.deepEqual(calendarDayKeys(now, 1), [dayKey(now)]);
  assert.equal(calendarDayKeys(now, 0).length, 1);
  assert.equal(calendarDayKeys(now, Number.NaN).length, 1);
  assert.equal(new Set(calendarDayKeys(now, 7)).size, 7);
  assert.equal(calendarSpanDays(now, now, 365), 1);
  assert.equal(calendarSpanDays(now - 10 * 86400000, now, 3), 3);
  assert.ok(calendarSpanDays(now - 3 * 86400000, now, 365) >= 3);
  assert.equal(bookDayKey({ key: '2026-10-25', tokens: 35 }), '2026-10-25');
  assert.equal(bookDayKey(null), null);
  assert.equal(bookDayKey({}), null);
  assert.equal(bookDayKey({ start: now }), dayKey(now));
  assert.equal(yesterdayKey(now), calendarDayKeys(now, 2)[0]);
  assert.equal(dayKey(rangeCutoff(now, 1)), dayKey(now));
  assert.equal(dayKey(rangeCutoff(now, 0)), dayKey(now));
  const week = calendarDayKeys(now, 7);
  assert.equal(dayKey(rangeCutoff(now, 7)), week[0]);
});
