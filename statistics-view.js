/* UI-only statistics view. Reads the app's state; never writes stored records. */
(function (root) {
  'use strict';
  const { getPeriod, shiftPeriod, summarize } = root.DiaryStatistics;
  const names = { week: '周', month: '月', year: '年' };
  const $ = id => document.getElementById(id);
  function create(getState) {
    let mode = 'month';
    let anchor = Date.now();
    let followCurrent = true;
    let chartType = 'frequency';
    let selectedBucket = '';
    let open = false;
    let recordsScroll = 0;
    let data = null;

    function rangeLabel(period) {
      const start = new Date(period.start);
      const end = new Date(period.end);
      end.setDate(end.getDate() - 1);
      if (mode === 'year') return `${start.getFullYear()}年`;
      if (mode === 'month') return `${start.getFullYear()}年${start.getMonth() + 1}月`;
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 — ${end.getFullYear() !== start.getFullYear() ? `${end.getFullYear()}年` : ''}${end.getMonth() + 1}月${end.getDate()}日`;
    }
    function selectBucket(key) {
      const bucket = data?.buckets.find(item => item.key === key && !item.future);
      selectedBucket = bucket ? key : '';
      $('stats-bucket-select').value = selectedBucket;
      $('stats-chart-detail').textContent = bucket ? `${bucket.fullLabel}：${bucket.count} 次，其中补签 ${bucket.manual} 次` : '点击柱子或选择日期，查看次数与补签数量。';
      for (const button of $('stats-bars').children) {
        button.setAttribute('aria-pressed', String(button.dataset.key === selectedBucket));
      }
    }
    function renderFrequency() {
      const max = Math.max(0, ...data.buckets.map(bucket => bucket.count));
      const step = Math.max(1, Math.ceil(max / 4));
      const ceiling = step * 4;
      const ticks = document.createDocumentFragment();
      for (let index = 0; index <= 4; index++) {
        const tick = document.createElement('span');
        tick.textContent = index * step;
        tick.style.bottom = `${index * 25}%`;
        ticks.append(tick);
      }
      $('stats-y-axis').replaceChildren(ticks);
      const bars = document.createDocumentFragment();
      const labels = document.createDocumentFragment();
      const options = document.createDocumentFragment();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = mode === 'year' ? '选择月份' : '选择日期';
      options.append(placeholder);
      data.buckets.forEach((bucket, index) => {
        const label = `${bucket.fullLabel}：${bucket.future ? '尚未到来' : `${bucket.count} 次，其中补签 ${bucket.manual} 次`}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `chart-bar${bucket.future ? ' future' : bucket.count === 0 ? ' zero' : ''}`;
        button.dataset.key = bucket.key;
        button.disabled = bucket.future;
        button.setAttribute('aria-label', label);
        button.title = label;
        button.addEventListener('click', () => selectBucket(bucket.key));
        const fill = document.createElement('span');
        fill.className = 'bar-fill';
        fill.style.height = `${bucket.count / ceiling * 100}%`;
        button.append(fill);
        bars.append(button);
        const tick = document.createElement('span');
        // Thin monthly labels, never the underlying data or selectable columns.
        const show = mode !== 'month' || index === 0 || (index + 1) % 5 === 0 || index === data.buckets.length - 1;
        tick.textContent = show ? bucket.label : '';
        if (bucket.future) tick.className = 'future-label';
        labels.append(tick);
        const option = document.createElement('option');
        option.value = bucket.key;
        option.textContent = label;
        option.disabled = bucket.future;
        options.append(option);
      });
      $('stats-bars').style.setProperty('--columns', data.buckets.length);
      $('stats-x-labels').style.setProperty('--columns', data.buckets.length);
      $('stats-bars').replaceChildren(bars);
      $('stats-x-labels').replaceChildren(labels);
      $('stats-bucket-select').replaceChildren(options);
      $('stats-x-unit').textContent = mode === 'year' ? '月份' : mode === 'week' ? '星期' : '日期';
      $('stats-bucket-label').textContent = mode === 'year' ? '查看月份' : '查看日期';
      $('stats-future-note').hidden = !data.buckets.some(bucket => bucket.future);
      $('stats-chart').setAttribute('aria-label', `${rangeLabel(data)}，${mode === 'year' ? '每月' : '每日'}记录次数，总计 ${data.total} 次`);
      selectBucket(selectedBucket);
    }
    function renderTimeSlots() {
      const max = Math.max(1, ...data.timeSlots.map(slot => slot.count));
      const rows = document.createDocumentFragment();
      for (const slot of data.timeSlots) {
        const row = document.createElement('li');
        row.className = 'time-slot';
        row.setAttribute('aria-label', `${slot.name} ${slot.range}，${slot.count} 次`);
        const heading = document.createElement('div');
        heading.className = 'time-slot-heading';
        const label = document.createElement('span');
        label.textContent = slot.name;
        const range = document.createElement('small');
        range.textContent = slot.range;
        label.append(range);
        const count = document.createElement('strong');
        count.textContent = `${slot.count} 次`;
        heading.append(label, count);
        const track = document.createElement('div');
        track.className = 'time-track';
        track.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('span');
        fill.style.width = `${slot.count / max * 100}%`;
        track.append(fill);
        row.append(heading, track);
        rows.append(row);
      }
      $('stats-time-slots').replaceChildren(rows);
    }
    function refresh() {
      if (!open) return;
      const now = Date.now();
      if (followCurrent) anchor = now;
      const current = getPeriod(mode, now);
      if (getPeriod(mode, anchor).start > current.start) { anchor = now; followCurrent = true; }
      const { records, readable } = getState();
      data = summarize(readable ? records : [], mode, anchor, now);
      const isCurrent = data.start === current.start;
      $('stats-range').textContent = rangeLabel(data);
      $('stats-period-context').textContent = `${isCurrent ? `本${names[mode]}` : `历史${names[mode]}统计`}${mode === 'week' ? ' · 周一至周日' : ''}`;
      $('stats-prev').setAttribute('aria-label', `上一${names[mode]}`);
      $('stats-next').setAttribute('aria-label', `下一${names[mode]}`);
      $('stats-next').disabled = isCurrent;
      $('stats-current').hidden = isCurrent;
      $('stats-current').textContent = `回到本${names[mode]}`;
      for (const button of document.querySelectorAll('[data-stats-period]')) button.setAttribute('aria-pressed', String(button.dataset.statsPeriod === mode));
      for (const button of document.querySelectorAll('[data-stats-chart]')) button.setAttribute('aria-pressed', String(button.dataset.statsChart === chartType));
      $('stats-frequency-tab').textContent = mode === 'year' ? '每月次数' : '每日次数';
      $('stats-total').textContent = readable ? data.total : '—';
      $('stats-active-days').textContent = readable ? data.activeDays : '—';
      $('stats-average').textContent = readable ? data.average.toFixed(2) : '—';
      $('stats-average-note').textContent = readable ? `日均 = ${data.total} 次 ÷ ${data.elapsedDays} 天${isCurrent ? '（截至今天，含今天）' : '（完整周期）'}` : '无法读取本地记录，暂时无法统计。';
      $('stats-manual-note').textContent = readable ? `包含 ${data.manual} 次补签，按实际发生时间计入` : '原有数据未被修改，请检查存储权限或刷新重试。';
      const empty = !readable || data.total === 0;
      $('stats-empty').hidden = !empty;
      $('stats-empty-title').textContent = readable ? `这个${names[mode]}还没有记录` : '统计暂不可用';
      $('stats-empty-description').textContent = readable ? '已有的打卡和补签会自动汇总到这里。' : '无法读取记录时，不会将其当作零次记录。';
      $('stats-frequency').hidden = empty || chartType !== 'frequency';
      $('stats-time').hidden = empty || chartType !== 'time';
      if (empty) {
        $('stats-bars').replaceChildren();
        $('stats-time-slots').replaceChildren();
        selectedBucket = '';
      } else {
        renderFrequency();
        renderTimeSlots();
      }
    }
    $('view-toggle').addEventListener('click', () => {
      if (!open) recordsScroll = window.scrollY;
      open = !open;
      $('records-view').hidden = open;
      $('statistics-view').hidden = !open;
      $('view-toggle').textContent = open ? '返回记录' : '统计';
      $('view-toggle').setAttribute('aria-pressed', String(open));
      refresh();
      window.scrollTo(0, open ? 0 : recordsScroll);
    });
    for (const button of document.querySelectorAll('[data-stats-period]')) {
      button.addEventListener('click', () => {
        if (mode === button.dataset.statsPeriod) return;
        mode = button.dataset.statsPeriod;
        anchor = Date.now();
        followCurrent = true;
        selectedBucket = '';
        refresh();
      });
    }
    for (const button of document.querySelectorAll('[data-stats-chart]')) {
      button.addEventListener('click', () => { chartType = button.dataset.statsChart; refresh(); });
    }
    function navigate(offset) {
      const next = shiftPeriod(mode, anchor, offset);
      const current = getPeriod(mode, Date.now());
      if (next.start > current.start) return;
      anchor = next.start;
      followCurrent = next.start === current.start;
      selectedBucket = '';
      refresh();
    }
    $('stats-prev').addEventListener('click', () => navigate(-1));
    $('stats-next').addEventListener('click', () => navigate(1));
    $('stats-current').addEventListener('click', () => { followCurrent = true; selectedBucket = ''; refresh(); });
    $('stats-bucket-select').addEventListener('change', event => selectBucket(event.target.value));
    return { refresh };
  }
  root.DiaryStatsView = Object.freeze({ create });
})(window);
