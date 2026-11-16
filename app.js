/**
 * 主页面控制器：协调日历、记录列表、打卡、补签、删除及本地存储。
 * 本文件依赖先加载的 DiaryCore 和 DiaryStatsView；立即执行函数隔离内部状态。
 * 数据流：读取并校验存储 → 内存 records → 渲染；修改时先写入成功，再更新内存和界面。
 */
(() => {
  'use strict';
  const { backfillTimestamp, STORAGE_KEY, dateKey, formatTime, monthCells, recordsForDate, loadRecords, saveRecords } = window.DiaryCore;
  // 简写的 DOM 查询器；这里的 id 必须与 index.html 保持一致。
  const $ = id => document.getElementById(id);
  // 初始日期只用于启动状态；真正打卡、补签校验和日期刷新时都会重新取时间。
  const now = new Date();
  // 当前展示的月份与当前选中的日期分开保存：翻月不等于选择某一天。
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  let selectedDate = dateKey(now);
  // 缓存上次渲染时的今天，用于识别页面跨午夜停留的情况。
  let today = selectedDate;
  // 已成功读取或保存的内存记录；存储读失败时保留它，但禁止继续写入。
  let records = [];
  // readable 控制数据是否可信；busy 控制打卡保存及成功后的短暂冷却。
  let readable = true;
  let busy = false;
  // 对话框暂存的是删除目标 id 或补签日期；用户取消/关闭后清空。
  let pendingDelete = null;
  let pendingBackfill = null;
  // 补签单独防重复提交，不与普通打卡的冷却状态混用。
  let backfillBusy = false;
  let toastTimer;
  const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  // 固定的本地 SVG 模板，不含用户输入；其余动态记录文字通过 textContent 填入。
  const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg>';

  // 页顶持久错误提示，与短暂显示的成功 toast 分开，避免错误一闪而过。
  function reportError(message) {
    $('storage-error').textContent = message;
    $('storage-error').hidden = false;
  }
  /**
   * 从浏览器重新读取并校验记录，返回是否成功。
   * 新增/删除前也调用它，以尽量保留其他标签页刚写入的记录。
   * localStorage 不提供这里所需的事务锁：读后再写不能保证并发操作原子性。
   */
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
  // 成功提示显示 2.4 秒；取消旧计时器，避免旧消息的计时器提前隐藏新消息。
  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2400);
  }
  // 根据当前月份重建 42 个日期按钮，并分别标记今天、选中日及有记录的日期。
  function renderCalendar() {
    $('month-title').textContent = `${viewYear}年 ${viewMonth + 1}月`;
    $('month-subtitle').textContent = `${monthNames[viewMonth]} ${viewYear}`;
    // 一次遍历汇总每天的条数，避免每个日期格都扫描完整记录数组。
    const recordedDays = new Map();
    for (const record of records) {
      const key = dateKey(record.timestamp);
      recordedDays.set(key, (recordedDays.get(key) || 0) + 1);
    }
    // 先在文档片段中组装按钮，再一次替换页面内容。
    const fragment = document.createDocumentFragment();
    for (const cell of monthCells(viewYear, viewMonth)) {
      const button = document.createElement('button');
      const count = recordedDays.get(cell.key) || 0;
      button.type = 'button';
      button.className = ['day', cell.outside && 'outside', cell.key === today && 'today', cell.key === selectedDate && 'selected', count && 'has-records'].filter(Boolean).join(' ');
      button.textContent = cell.day;
      button.dataset.date = cell.key;
      // 可访问名称包含日期与条数；选中状态和今天状态不只依赖颜色表达。
      button.setAttribute('aria-label', `${cell.year}年${cell.month + 1}月${cell.day}日${cell.key === today ? '，今天' : ''}，${count}条记录`);
      button.setAttribute('aria-pressed', String(cell.key === selectedDate));
      if (cell.key === today) button.setAttribute('aria-current', 'date');
      button.addEventListener('click', () => {
        selectedDate = cell.key;
        viewYear = cell.year;
        viewMonth = cell.month;
        render();
        // 按钮被重建后恢复键盘焦点，避免键盘用户每次选择日期都丢失操作位置。
        $('calendar-days').querySelector(`[data-date="${cell.key}"]`)?.focus({ preventScroll: true });
      });
      fragment.append(button);
    }
    $('calendar-days').replaceChildren(fragment);
  }
  // 展示所选日期的记录（最新在前）；读取失败不伪装成“这天没有记录”。
  function renderRecords() {
    const [year, month, day] = selectedDate.split('-').map(Number);
    const dateLabel = `${month}月${day}日`;
    $('records-title').textContent = selectedDate === today ? `今天 · ${dateLabel}` : `${year}年${dateLabel}`;
    const items = recordsForDate(records, selectedDate);
    $('record-count').textContent = readable ? `${items.length} 条记录` : '暂不可用';
    $('empty-state').hidden = items.length > 0 || !readable;
    // 过去日期才提供补签入口；今天和未来日期不能补签。
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
      // datetime 使用标准 ISO 时间供机器读取，可见文字仍使用设备本地时间。
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
      // 第一次点击只打开确认框；真正的数据删除在 confirm-delete 处理器执行。
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
  // 统一刷新入口：重新计算今天，并通知已打开的统计视图重新汇总。
  function render() {
    today = dateKey(new Date());
    renderCalendar();
    renderRecords();
    $('checkin').disabled = busy || !readable;
    statistics.refresh();
  }
  // 普通打卡后返回真实今天；不能使用当前正在浏览的历史日期作为打卡日期。
  function goToday() {
    const date = new Date();
    selectedDate = dateKey(date);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
  }
  // 以目标月 1 日构造日期，让 Date 自动处理跨年，避免月末天数溢出。
  function shiftMonth(offset) {
    const date = new Date(viewYear, viewMonth + offset, 1, 12);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth();
    renderCalendar();
  }
  /**
   * 提交候选记录数组，成功返回 true，失败返回 false。
   * 必须先保存、后赋值 records；保存失败时不能展示新增/删除成功的假象。
   * 此函数只负责持久化和错误提示，具体操作负责后续渲染及成功提示。
   */
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

  // —— 日历导航与普通打卡 ——
  $('previous-month').addEventListener('click', () => shiftMonth(-1));
  $('next-month').addEventListener('click', () => shiftMonth(1));
  $('go-today').addEventListener('click', () => { goToday(); render(); });
  // 同步设置 busy 和禁用按钮，阻止快速连点；读取失败或写入失败会立即解除忙状态。
  // 成功后仍禁用 1.5 秒，之后允许同一天继续记录。
  $('checkin').addEventListener('click', () => {
    if (busy || !readable) return;
    busy = true;
    $('checkin').disabled = true;
    if (!readLatest()) { busy = false; render(); return; }
    // 点击处理时才取实际时间，不使用页面刚打开时保存的 now。
    const timestamp = Date.now();
    // 优先使用随机 UUID；不支持该 API 的环境使用时间戳加随机串作为后备标识。
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
  // —— 补签对话框：表单错误保留在框内，不清空用户已输入的时间 ——
  function backfillError(message, invalidTime = false) {
    $('backfill-error').textContent = message;
    $('backfill-error').hidden = false;
    $('backfill-time').setAttribute('aria-invalid', String(invalidTime));
  }
  $('backfill').addEventListener('click', () => {
    if (!readable || selectedDate >= dateKey(Date.now())) return;
    // 固定本次补签日期，并重置上次输入；不猜测或预填用户实际发生的时间。
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
  // 拦截表单默认提交，不刷新页面，也不向服务器发送表单。
  $('backfill-form').addEventListener('submit', event => {
    event.preventDefault();
    if (backfillBusy || !pendingBackfill || !$('backfill-dialog').open) return;
    let timestamp;
    try {
      // 提交时再次验证日期和时间，不只依靠 HTML 输入控件的前端限制。
      timestamp = backfillTimestamp(pendingBackfill, $('backfill-time').value);
    } catch (error) {
      backfillError(error.message, true);
      $('backfill-time').focus();
      return;
    }
    backfillBusy = true;
    $('confirm-backfill').disabled = true;
    try {
      // 写入前重新读取，以尽量保留其他标签页的修改，并兼容原有旧记录。
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
      // 补签成功后仍停留在所选历史日期，不像普通打卡那样跳回今天。
      pendingBackfill = null;
      $('backfill-dialog').close();
      render();
      notify(`已补签 · ${formatTime(timestamp)}`);
    // 无论保存成功、失败或提前返回，都恢复补签按钮，允许失败后重试。
    } finally {
      backfillBusy = false;
      $('confirm-backfill').disabled = false;
      $('backfill').disabled = !readable;
      if (!$('backfill-dialog').open) $('backfill').focus({ preventScroll: true });
    }
  });
  // —— 删除：关闭/取消只清理待删除 id，确认后重新读取再按唯一 id 删除 ——
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
  // 同源其他标签页修改存储时重新读取；key 为 null 表示整个存储被 clear()。
  // 当前标签页自己的写入不会触发自己的 storage 事件，所以提交后仍需主动 render()。
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) { readLatest(); render(); }
  });
  // 跨午夜刷新：原本看今天则跟随新今天；看历史日期则保留选择。
  // 统计模块也会通过 render() 更新“当前周期”，但不会强制改变历史统计周期。
  function refreshDate() {
    if (dateKey(new Date()) !== today) {
      if (selectedDate === today) goToday();
      render();
    }
  }
  // 后台标签页计时器可能被限频，回到窗口或恢复可见时也检查日期。
  window.addEventListener('focus', refreshDate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
  setInterval(refreshDate, 30000);
  // 先创建统计控制器，再首次 render()，避免渲染时访问尚未初始化的对象。
  // 通过回调提供最新状态，不把可写存储权限或 records 的旧快照交给统计界面。
  const statistics = window.DiaryStatsView.create(() => ({ records, readable }));
  readLatest();
  render();
})();
