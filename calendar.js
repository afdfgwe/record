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
          !Number.isSafeInteger(item.timestamp) || !Number.isFinite(new Date(item.timestamp).getTime())) {
        throw new Error('Invalid record data');
      }
      ids.add(item.id);
    }
    return data.map(({ id, timestamp }) => ({ id, timestamp }));
  }
  function recordsForDate(records, key) {
    return records.filter(record => dateKey(record.timestamp) === key).sort((a, b) => b.timestamp - a.timestamp);
  }
  function loadRecords(storage) { return parseRecords(storage.getItem(STORAGE_KEY)); }
  function saveRecords(storage, records) { storage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  const api = { STORAGE_KEY, dateKey, formatTime, monthCells, parseRecords, recordsForDate, loadRecords, saveRecords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiaryCore = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
