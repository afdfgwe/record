/**
 * 统计视图控制器：负责周期导航、概览、次数柱状图与时间分布图的 DOM 渲染。
 * 依赖 DiaryStatistics 计算数据，通过 getState() 向主页面获取最新记录及可读状态。
 * 不操作 localStorage，不添加统计副本；所有图表都是当前记录的即时派生结果。
 */

(function (root) {
  'use strict';
  const { getPeriod, shiftPeriod, summarize } = root.DiaryStatistics;
  const names = { week: '周', month: '月', year: '年' };
  const $ = id => document.getElementById(id);
  /**
   * 绑定单页中的统计相关控件，返回 { refresh } 供 app.js 在数据/日期变化后调用。
   * getState() 返回 { records, readable }；所有视图状态保存在闭包中，不污染全局。
   */
  function create(getState) {
    // 周期粒度默认为月；anchor 是定位当前所选周期的时间，不是过滤记录的唯一日期。
    let mode = 'month';
    let anchor = Date.now();
    // true 表示跟随真实当前周期；浏览历史时置 false，跨午夜也保留历史选择。
    let followCurrent = true;
    // frequency 为次数柱状图，time 为时间段分布；切换图表不切换统计周期。
    let chartType = 'frequency';
    // 记录被选中的日/月分组键；重绘后仍可恢复该柱子的详情及高亮。
    let selectedBucket = '';
    let open = false;
    // 进入统计前记住记录页滚动位置；返回时恢复，且不修改日历所选日期。
    let recordsScroll = 0;
    let data = null;

    // 生成人类可读的周期标题；end 不含在区间内，因此显示时向前减一个日历日。
    function rangeLabel(period) {
      const start = new Date(period.start);
      const end = new Date(period.end);
      end.setDate(end.getDate() - 1);
      if (mode === 'year') return `${start.getFullYear()}年`;
      if (mode === 'month') return `${start.getFullYear()}年${start.getMonth() + 1}月`;
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 — ${end.getFullYear() !== start.getFullYear() ? `${end.getFullYear()}年` : ''}${end.getMonth() + 1}月${end.getDate()}日`;
    }
    // 同步柱子选中态、下拉框和详情文字；未来日期不允许选择。
    function selectBucket(key) {
      const bucket = data?.buckets.find(item => item.key === key && !item.future);
      selectedBucket = bucket ? key : '';
      $('stats-bucket-select').value = selectedBucket;
      $('stats-chart-detail').textContent = bucket ? `${bucket.fullLabel}：${bucket.count} 次，其中补签 ${bucket.manual} 次` : '点击柱子或选择日期，查看次数与补签数量。';
      for (const button of $('stats-bars').children) {
        button.setAttribute('aria-pressed', String(button.dataset.key === selectedBucket));
      }
    }
    // 使用原生按钮和 CSS 高度绘制柱状图，保留键盘操作与无障碍名称。
    // 重绘只影响当前图表，不创建任何额外网络请求或第三方图表实例。
    function renderFrequency() {
      const max = Math.max(0, ...data.buckets.map(bucket => bucket.count));
      // 纵轴划分四个等高区间，刻度步长至少为 1，避免“次数”出现小数刻度。
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
      // 分别组装柱子、横轴标签和下拉选项，再一次替换对应容器。
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
        // 未到来的日期采用禁用和斜纹样式，与“已经过去但次数为零”区分。
        button.disabled = bucket.future;
        button.setAttribute('aria-label', label);
        button.title = label;
        button.addEventListener('click', () => selectBucket(bucket.key));
        const fill = document.createElement('span');
        fill.className = 'bar-fill';
        // 柱高相对纵轴上限计算，而不是相对所有记录总数；零次数基线由 CSS 绘制。
        fill.style.height = `${bucket.count / ceiling * 100}%`;
        button.append(fill);
        bars.append(button);
        const tick = document.createElement('span');
        // 月视图只稀疏显示横轴文字，所有日期的数据柱和选择选项仍完整保留。
        const show = mode !== 'month' || index === 0 || (index + 1) % 5 === 0 || index === data.buckets.length - 1;
        tick.textContent = show ? bucket.label : '';
        if (bucket.future) tick.className = 'future-label';
        labels.append(tick);
        // 月视图的柱子在手机上较窄，下拉框提供不依赖精细点击的等价选择方式。
        const option = document.createElement('option');
        option.value = bucket.key;
        option.textContent = label;
        option.disabled = bucket.future;
        options.append(option);
      });
      // 同一套 CSS 网格通过列数变量适配 7 天、28～31 天以及 12 个月。
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
    // 四个时间段用横条显示次数；以最高时段次数归一化，不代表百分比占比。
    function renderTimeSlots() {
      // 最低上限取 1，确保没有记录时也不会发生除以零。
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
    /**
     * 主刷新入口：校正周期 → 获取最新状态 → 汇总 → 更新概览及图表。
     * 未打开统计时直接返回，避免普通打卡界面每次渲染都计算和创建图表。
     */
    function refresh() {
      if (!open) return;
      const now = Date.now();
      // 当前周期可随跨日/跨月变化；若设备时间回拨导致锚点在未来，也回到当前周期。
      if (followCurrent) anchor = now;
      const current = getPeriod(mode, now);
      if (getPeriod(mode, anchor).start > current.start) { anchor = now; followCurrent = true; }
      const { records, readable } = getState();
      // 不可读状态只用空数组完成内部计算；界面显示“—”和错误，不展示虚假的零次。
      data = summarize(readable ? records : [], mode, anchor, now);
      const isCurrent = data.start === current.start;
      $('stats-range').textContent = rangeLabel(data);
      $('stats-period-context').textContent = `${isCurrent ? `本${names[mode]}` : `历史${names[mode]}统计`}${mode === 'week' ? ' · 周一至周日' : ''}`;
      $('stats-prev').setAttribute('aria-label', `上一${names[mode]}`);
      $('stats-next').setAttribute('aria-label', `下一${names[mode]}`);
      // 当前周期是可导航的最晚周期；回到当前周期后隐藏多余的返回按钮。
      $('stats-next').disabled = isCurrent;
      $('stats-current').hidden = isCurrent;
      $('stats-current').textContent = `回到本${names[mode]}`;
      for (const button of document.querySelectorAll('[data-stats-period]')) button.setAttribute('aria-pressed', String(button.dataset.statsPeriod === mode));
      for (const button of document.querySelectorAll('[data-stats-chart]')) button.setAttribute('aria-pressed', String(button.dataset.statsChart === chartType));
      $('stats-frequency-tab').textContent = mode === 'year' ? '每月次数' : '每日次数';
      // 日均固定两位小数，并在下方明确分母，避免误解成“有记录日的平均次数”。
      $('stats-total').textContent = readable ? data.total : '—';
      $('stats-active-days').textContent = readable ? data.activeDays : '—';
      $('stats-average').textContent = readable ? data.average.toFixed(2) : '—';
      $('stats-average-note').textContent = readable ? `日均 = ${data.total} 次 ÷ ${data.elapsedDays} 天${isCurrent ? '（截至今天，含今天）' : '（完整周期）'}` : '无法读取本地记录，暂时无法统计。';
      $('stats-manual-note').textContent = readable ? `包含 ${data.manual} 次补签，按实际发生时间计入` : '原有数据未被修改，请检查存储权限或刷新重试。';
      // 没有记录和读取失败都隐藏图表，但分别给出空状态与错误状态的文案。
      const empty = !readable || data.total === 0;
      $('stats-empty').hidden = !empty;
      $('stats-empty-title').textContent = readable ? `这个${names[mode]}还没有记录` : '统计暂不可用';
      $('stats-empty-description').textContent = readable ? '已有的打卡和补签会自动汇总到这里。' : '无法读取记录时，不会将其当作零次记录。';
      $('stats-frequency').hidden = empty || chartType !== 'frequency';
      $('stats-time').hidden = empty || chartType !== 'time';
      // 清理旧柱子和选择，避免读取失败后还展示上一次成功读取的图表。
      if (empty) {
        $('stats-bars').replaceChildren();
        $('stats-time-slots').replaceChildren();
        selectedBucket = '';
      } else {
        renderFrequency();
        renderTimeSlots();
      }
    }
    // —— 记录/统计视图切换：只切换可见性，不重置主日历状态 ——
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
    // 更换周/月/年粒度时回到该粒度的当前周期，不沿用上一种粒度的历史锚点。
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
    // 图表类型切换保留当前粒度和周期，便于对比同一批记录的两种分布。
    for (const button of document.querySelectorAll('[data-stats-chart]')) {
      button.addEventListener('click', () => { chartType = button.dataset.statsChart; refresh(); });
    }
    // 前后周期导航双重防护：除按钮禁用之外，逻辑层也拒绝进入未来周期。
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
    // 两种日期详情入口共用 selectBucket，保证柱子与选择框始终一致。
    $('stats-bucket-select').addEventListener('change', event => selectBucket(event.target.value));
    // 对主页面仅暴露刷新方法；周期、图表类型等交互状态留在模块内部。
    return { refresh };
  }
  root.DiaryStatsView = Object.freeze({ create });
})(window);
