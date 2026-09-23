/* Shared, dependency-free calendar and persistence helpers. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'personal-records.v1';
  const pad = value => String(value).padStart(2, '0');
  function dateKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function formatTime(value) {
    const date = new Date(value);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  function monthCells(year, month) {
    // Noon avoids DST transitions at midnight when walking calendar dates.
    const first = new Date(year, month, 1, 12);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(year, month, 1 - offset + index, 12);
      return { key: dateKey(date), day: date.getDate(), month: date.getMonth(), year: date.getFullYear(), outside: date.getMonth() !== month };
    });
  }
  function parseRecords(raw) {
    if (raw === null) return [];
    const data = JSON.parse(raw);
    const ids = new Set();
    if (!Array.isArray(data)) throw new Error('Invalid record data');
    for (const item of data) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
          !Number.isSafeInteger(item.timestamp) || !Number.isFinite(new Date(item.timestamp).getTime()) ||
          (item.source !== undefined && !['checkin', 'manual'].includes(item.source))) {
        throw new Error('Invalid record data');
      }
      ids.add(item.id);
    }
    return data.map(({ id, timestamp, source }) => source === undefined ? { id, timestamp } : { id, timestamp, source });
  }
  function backfillTimestamp(key, time, now = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key >= dateKey(now)) {
      throw new Error('只能为过去的日期补签，请重新选择日期。');
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error('请选择那次实际发生的时间，精确到分钟。');
    }
    const [year, month, day] = key.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(hour, minute, 0, 0);
    // Reject invalid dates and local times skipped by a daylight-saving change.
    if (year < 1 || dateKey(date) !== key || date.getHours() !== hour || date.getMinutes() !== minute) {
      throw new Error('该日期或时间在当前时区无效，请重新选择。');
    }
    return date.getTime();
  }
  function recordsForDate(records, key) {
    return records.filter(record => dateKey(record.timestamp) === key).sort((a, b) => b.timestamp - a.timestamp);
  }
  function loadRecords(storage) { return parseRecords(storage.getItem(STORAGE_KEY)); }
  function saveRecords(storage, records) { storage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  const api = { backfillTimestamp, STORAGE_KEY, dateKey, formatTime, monthCells, parseRecords, recordsForDate, loadRecords, saveRecords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiaryCore = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
