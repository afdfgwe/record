/* Local-time statistics. End boundaries are exclusive; nothing is persisted here. */
(function (root) {
  'use strict';
  const { dateKey } = typeof module !== 'undefined' && module.exports ? require('./calendar.js') : root.DiaryCore;
  const MODES = ['week', 'month', 'year'];
  function localDate(year, month, day) {
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month, day);
    return date;
  }
  function getPeriod(mode, anchor = Date.now()) {
    if (!MODES.includes(mode)) throw new Error('Unknown statistics period');
    const date = new Date(anchor);
    if (!Number.isFinite(date.getTime())) throw new Error('Invalid statistics date');
    const year = date.getFullYear();
    const month = date.getMonth();
    let start;
    let end;
    if (mode === 'week') {
      start = localDate(year, month, date.getDate() - (date.getDay() + 6) % 7);
      end = localDate(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    } else if (mode === 'month') {
      start = localDate(year, month, 1);
      end = localDate(year, month + 1, 1);
    } else {
      start = localDate(year, 0, 1);
      end = localDate(year + 1, 0, 1);
    }
    return { mode, start: start.getTime(), end: end.getTime() };
  }
  function shiftPeriod(mode, anchor, offset) {
    const start = new Date(getPeriod(mode, anchor).start);
    if (mode === 'week') start.setDate(start.getDate() + offset * 7);
    else if (mode === 'month') start.setMonth(start.getMonth() + offset);
    else start.setFullYear(start.getFullYear() + offset);
    return getPeriod(mode, start);
  }
  function summarize(records, mode, anchor = Date.now(), now = Date.now()) {
    const period = getPeriod(mode, anchor);
    const todayKey = dateKey(now);
    const buckets = [];
    let elapsedDays = 0;
    // Walk calendar days instead of dividing elapsed milliseconds by 24 hours (DST).
    for (const cursor = new Date(period.start); cursor.getTime() < period.end; cursor.setDate(cursor.getDate() + 1)) {
      const key = dateKey(cursor);
      if (key <= todayKey) elapsedDays++;
      if (mode === 'year' && cursor.getDate() !== 1) continue;
      const bucketKey = mode === 'year' ? key.slice(0, 7) : key;
      buckets.push({
        key: bucketKey,
        label: mode === 'year' ? String(cursor.getMonth() + 1) : mode === 'week' ? ['一', '二', '三', '四', '五', '六', '日'][(cursor.getDay() + 6) % 7] : String(cursor.getDate()),
        fullLabel: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月${mode === 'year' ? '' : `${cursor.getDate()}日`}`,
        count: 0,
        manual: 0,
        future: key > todayKey,
      });
    }
    const bucketMap = new Map(buckets.map(bucket => [bucket.key, bucket]));
    const timeSlots = [
      { name: '凌晨', range: '00:00–05:59', count: 0 },
      { name: '上午', range: '06:00–11:59', count: 0 },
      { name: '下午', range: '12:00–17:59', count: 0 },
      { name: '晚上', range: '18:00–23:59', count: 0 },
    ];
    const activeDays = new Set();
    let total = 0;
    let manual = 0;
    for (const record of records) {
      if (record.timestamp < period.start || record.timestamp >= period.end || record.timestamp > now) continue;
      const key = dateKey(record.timestamp);
      const bucket = bucketMap.get(mode === 'year' ? key.slice(0, 7) : key);
      if (!bucket) continue;
      total++;
      bucket.count++;
      if (record.source === 'manual') { manual++; bucket.manual++; }
      activeDays.add(key);
      timeSlots[Math.floor(new Date(record.timestamp).getHours() / 6)].count++;
    }
    return { ...period, total, manual, activeDays: activeDays.size, elapsedDays, average: elapsedDays ? total / elapsedDays : 0, buckets, timeSlots };
  }
  const api = { getPeriod, shiftPeriod, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiaryStatistics = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
