(() => {
  'use strict';
  const { backfillTimestamp, STORAGE_KEY, dateKey, formatTime, monthCells, recordsForDate, loadRecords, saveRecords } = window.DiaryCore;
  const $ = id => document.getElementById(id);
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  let selectedDate = dateKey(now);
  let today = selectedDate;
  let records = [];
  let readable = true;
  let busy = false;
  let pendingDelete = null;
  let pendingBackfill = null;
  let backfillBusy = false;
  let toastTimer;
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';

  function reportError(message) {
    $('storage-error').textContent = message;
    $('storage-error').hidden = false;
  }
  function readLatest() {
    try {
      records = loadRecords(window.localStorage);
      readable = true;
      $('storage-error').hidden = true;
      return true;
    } catch {
      readable = false;
      reportError('无法读取本地记录，已暂停新增和删除，避免覆盖原有数据。请检查浏览器存储权限或刷新重试。');
      return false;
    }
  }
  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2400);
  }
  function renderCalendar() {
    $('month-title').textContent = `${viewYear}年 ${viewMonth + 1}月`;
    $('month-subtitle').textContent = `${monthNames[viewMonth]} ${viewYear}`;
    const recordedDays = new Map();
    for (const record of records) {
      const key = dateKey(record.timestamp);
      recordedDays.set(key, (recordedDays.get(key) || 0) + 1);
    }
    const fragment = document.createDocumentFragment();
    for (const cell of monthCells(viewYear, viewMonth)) {
      const button = document.createElement('button');
      const count = recordedDays.get(cell.key) || 0;
      button.type = 'button';
      button.className = ['day', cell.outside && 'outside', cell.key === today && 'today', cell.key === selectedDate && 'selected', count && 'has-records'].filter(Boolean).join(' ');
      button.textContent = cell.day;
      button.dataset.date = cell.key;
      button.setAttribute('aria-label', `${cell.year}年${cell.month + 1}月${cell.day}日${cell.key === today ? '，今天' : ''}，${count}条记录`);
      button.setAttribute('aria-pressed', String(cell.key === selectedDate));
      if (cell.key === today) button.setAttribute('aria-current', 'date');
      button.addEventListener('click', () => {
        selectedDate = cell.key;
        viewYear = cell.year;
        viewMonth = cell.month;
        render();
        // Re-rendering should not discard keyboard focus.
        $('calendar-days').querySelector(`[data-date="${cell.key}"]`)?.focus({ preventScroll: true });
      });
      fragment.append(button);
    }
    $('calendar-days').replaceChildren(fragment);
  }
  function renderRecords() {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dateLabel = `${month}月${day}日`;
    $('records-title').textContent = selectedDate === today ? `今天 · ${dateLabel}` : `${year}年${dateLabel}`;
    const items = recordsForDate(records, selectedDate);
    $('record-count').textContent = readable ? `${items.length} 条记录` : '暂不可用';
    $('empty-state').hidden = items.length > 0 || !readable;
    $('backfill').hidden = selectedDate >= today;
    $('backfill').disabled = !readable || backfillBusy;
    const fragment = document.createDocumentFragment();
    for (const record of items) {
      const row = document.createElement('li');
      row.className = 'record';
      const marker = document.createElement('span');
      marker.className = 'record-marker';
      marker.setAttribute('aria-hidden', 'true');
      const time = document.createElement('time');
      time.dateTime = new Date(record.timestamp).toISOString();
      time.textContent = formatTime(record.timestamp);
      const note = document.createElement('span');
      note.className = 'record-note';
      note.textContent = record.source === 'manual' ? '补签' : '已记录';
      if (record.source === 'manual') note.classList.add('manual');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button delete-button';
      remove.innerHTML = trashIcon;
      remove.disabled = !readable;
      remove.setAttribute('aria-label', `删除 ${formatTime(record.timestamp)} 的记录`);
      remove.addEventListener('click', () => {
        pendingDelete = record.id;
        $('delete-description').textContent = `${dateKey(record.timestamp)} ${formatTime(record.timestamp)} 的记录将被删除，此操作无法撤销。`;
        $('delete-dialog').showModal();
      });
      row.append(marker, time, note, remove);
      fragment.append(row);
    }
    $('records-list').replaceChildren(fragment);
  }
  function render() {
    today = dateKey(new Date());
    renderCalendar();
    renderRecords();
    $('checkin').disabled = busy || !readable;
  }
  function goToday() {
    const date = new Date();
    selectedDate = dateKey(date);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
  }
  function shiftMonth(offset) {
    const date = new Date(viewYear, viewMonth + offset, 1, 12);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
    renderCalendar();
  }
  function commit(next) {
    try {
      saveRecords(window.localStorage, next);
      records = next;
      $('storage-error').hidden = true;
      return true;
    } catch {
      reportError('保存失败，本次更改未生效。浏览器可能禁止存储或空间不足，请检查后重试。');
      return false;
    }
  }

  $('previous-month').addEventListener('click', () => shiftMonth(-1));
  $('next-month').addEventListener('click', () => shiftMonth(1));
  $('go-today').addEventListener('click', () => { goToday(); render(); });
  $('checkin').addEventListener('click', () => {
    if (busy || !readable) return;
    busy = true;
    $('checkin').disabled = true;
    if (!readLatest()) { busy = false; render(); return; }
    const timestamp = Date.now();
    const id = window.crypto?.randomUUID?.() || `${timestamp}-${Math.random().toString(36).slice(2)}`;
    if (!commit([...records, { id, timestamp }])) { busy = false; render(); return; }
    goToday();
    render();
    $('checkin-label').textContent = '已记录，留住这一刻';
    notify(`已记录 · ${formatTime(timestamp)}`);
    setTimeout(() => {
      busy = false;
      $('checkin').disabled = !readable;
      $('checkin-label').textContent = '打卡 · 记录当前时间';
    }, 1500);
  });
  function backfillError(message, invalidTime = false) {
    $('backfill-error').textContent = message;
    $('backfill-error').hidden = false;
    $('backfill-time').setAttribute('aria-invalid', String(invalidTime));
  }
  $('backfill').addEventListener('click', () => {
    if (!readable || selectedDate >= dateKey(Date.now())) return;
    pendingBackfill = selectedDate;
    $('backfill-form').reset();
    $('backfill-error').hidden = true;
    $('backfill-time').removeAttribute('aria-invalid');
    $('confirm-backfill').disabled = false;
    const [year, month, day] = pendingBackfill.split('-').map(Number);
    $('backfill-date').textContent = `${year}年${month}月${day}日`;
    $('backfill-date').dateTime = pendingBackfill;
    $('backfill-dialog').showModal();
  });
  $('cancel-backfill').addEventListener('click', () => $('backfill-dialog').close());
  $('backfill-dialog').addEventListener('close', () => {
    if (!$('backfill-dialog').open) pendingBackfill = null;
  });
  $('backfill-time').addEventListener('input', () => {
    $('backfill-error').hidden = true;
    $('backfill-time').removeAttribute('aria-invalid');
  });
  $('backfill-form').addEventListener('submit', event => {
    event.preventDefault();
    if (backfillBusy || !pendingBackfill || !$('backfill-dialog').open) return;
    let timestamp;
    try {
      timestamp = backfillTimestamp(pendingBackfill, $('backfill-time').value);
    } catch (error) {
      backfillError(error.message, true);
      $('backfill-time').focus();
      return;
    }
    backfillBusy = true;
    $('confirm-backfill').disabled = true;
    try {
      // Reload first to preserve changes from other tabs and legacy records.
      if (!readLatest()) {
        backfillError('无法读取已有记录，本次补签未保存。请检查浏览器存储权限后重试。');
        render();
        return;
      }
      const id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (!commit([...records, { id, timestamp, source: 'manual' }])) {
        backfillError('保存失败，本次补签未生效。请检查浏览器存储权限或空间后重试。');
        return;
      }
      // Keep viewing the selected historical day instead of jumping to today.
      pendingBackfill = null;
      $('backfill-dialog').close();
      render();
      notify(`已补签 · ${formatTime(timestamp)}`);
    } finally {
      backfillBusy = false;
      $('confirm-backfill').disabled = false;
      $('backfill').disabled = !readable;
      if (!$('backfill-dialog').open) $('backfill').focus({ preventScroll: true });
    }
  });
  $('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
  $('delete-dialog').addEventListener('close', () => { pendingDelete = null; });
  $('confirm-delete').addEventListener('click', () => {
    const id = pendingDelete;
    if (!id) return;
    if (!readLatest()) { $('delete-dialog').close(); render(); return; }
    const success = commit(records.filter(record => record.id !== id));
    $('delete-dialog').close();
    render();
    $('checkin').focus({ preventScroll: true });
    if (success) notify('记录已删除');
  });
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) { readLatest(); render(); }
  });
  function refreshDate() {
    if (dateKey(new Date()) !== today) {
      if (selectedDate === today) goToday();
      render();
    }
  }
  window.addEventListener('focus', refreshDate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
  setInterval(refreshDate, 30000);
  readLatest();
  render();
})();
