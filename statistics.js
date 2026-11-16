/**
 * 纯统计计算模块：只读取传入的记录，不修改记录、不访问 DOM、不写入存储。
 * 周、月、年边界均按设备本地时区计算；区间使用 [start, end)，不含下一周期起点。
 * 与日历共用 dateKey，确保补签、列表和图表对“同一天”的解释一致。
 */

(function (root) {
  'use strict';
  const { dateKey } = typeof module !== 'undefined' && module.exports ? require('./calendar.js') : root.DiaryCore;
  const MODES = ['week', 'month', 'year'];
  // 构造本地零点；month/day 允许溢出以计算跨月跨年，并兼容小于 100 的年份。
  function localDate(year, month, day) {
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month, day);
    return date;
  }
  /**
   * 根据锚点日期找到其所属周期，返回 { mode, start, end }（毫秒时间戳）。
   * mode 为 week / month / year；周固定从周一零点到下周一零点。
   * anchor 可为 Date 或毫秒时间戳；非法模式和日期会显式抛错。
   */
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
  /**
   * 向前或向后移动整数个周期，offset 通常为 -1 或 1。
   * 先归一到周期起点再移动，避免从 1 月 31 日切到 2 月时溢出到 3 月。
   * 此处只计算日期；禁止导航到未来周期由统计界面负责。
   */
  function shiftPeriod(mode, anchor, offset) {
    const start = new Date(getPeriod(mode, anchor).start);
    if (mode === 'week') start.setDate(start.getDate() + offset * 7);
    else if (mode === 'month') start.setMonth(start.getMonth() + offset);
    else start.setFullYear(start.getFullYear() + offset);
    return getPeriod(mode, start);
  }
  /**
   * 汇总给定周期：次数、补签数、有记录天数、日均次数、柱状图分组和时间段分布。
   * records 应为基础模块校验后的记录；anchor 决定查看的周期，now 决定“截至何时”。
   * 历史周期分母是完整天数；当前周期分母只含截至今天的日历天（含今天）。
   * 支持注入 now，便于测试午夜、闰年和未来日期；不依赖调用者修改系统时钟。
   */
  function summarize(records, mode, anchor = Date.now(), now = Date.now()) {
    const period = getPeriod(mode, anchor);
    const todayKey = dateKey(now);
    // buckets 是按时间顺序排列的图表分组：周/月按天，年按月。
    const buckets = [];
    let elapsedDays = 0;
    // 逐个本地日历日遍历，不用毫秒差除以 24 小时，避免夏令时的 23/25 小时日造成误差。
    for (const cursor = new Date(period.start); cursor.getTime() < period.end; cursor.setDate(cursor.getDate() + 1)) {
      const key = dateKey(cursor);
      // 日均分母必须按天累加，即使年视图后面跳过非月初日期，也不能漏计这些天。
      if (key <= todayKey) elapsedDays++;
      if (mode === 'year' && cursor.getDate() !== 1) continue;
      // 日分组键为 YYYY-MM-DD，月分组键为 YYYY-MM，便于直接定位对应柱子。
      const bucketKey = mode === 'year' ? key.slice(0, 7) : key;
      buckets.push({
        key: bucketKey,
        label: mode === 'year' ? String(cursor.getMonth() + 1) : mode === 'week' ? ['一', '二', '三', '四', '五', '六', '日'][(cursor.getDay() + 6) % 7] : String(cursor.getDate()),
        fullLabel: `${cursor.getFullYear()}年${cursor.getMonth() + 1}月${mode === 'year' ? '' : `${cursor.getDate()}日`}`,
        count: 0,
        manual: 0,
        // 年视图用该月第一天判断：当前月不属于未来，尚未到来的月份才标记为 future。
        future: key > todayKey,
      });
    }
    // 通过 Map 查找每条记录的分组，避免逐条扫描所有柱子。
    const bucketMap = new Map(buckets.map(bucket => [bucket.key, bucket]));
    // 四个左闭右开的六小时时段：06:00 计入上午，12:00 计入下午，18:00 计入晚上。
    const timeSlots = [
      { name: '凌晨', range: '00:00–05:59', count: 0 },
      { name: '上午', range: '06:00–11:59', count: 0 },
      { name: '下午', range: '12:00–17:59', count: 0 },
      { name: '晚上', range: '18:00–23:59', count: 0 },
    ];
    // Set 自动去重：同一天可以计入多次记录，但“有记录天数”只增加一天。
    const activeDays = new Set();
    let total = 0;
    let manual = 0;
    for (const record of records) {
      // 只纳入周期内且不晚于 now 的记录；异常的未来记录不会提前进入统计。
      if (record.timestamp < period.start || record.timestamp >= period.end || record.timestamp > now) continue;
      // 使用事件实际时间，不使用补签操作时间；补签天然归到原来发生的那一天。
      const key = dateKey(record.timestamp);
      const bucket = bucketMap.get(mode === 'year' ? key.slice(0, 7) : key);
      if (!bucket) continue;
      total++;
      bucket.count++;
      if (record.source === 'manual') { manual++; bucket.manual++; }
      activeDays.add(key);
      timeSlots[Math.floor(new Date(record.timestamp).getHours() / 6)].count++;
    }
    // 空周期/未来周期的分母可能为 0，此时返回 0，避免 NaN 或 Infinity。
    return { ...period, total, manual, activeDays: activeDays.size, elapsedDays, average: elapsedDays ? total / elapsedDays : 0, buckets, timeSlots };
  }
  // 保持浏览器全局与 Node.js 测试两种导出方式，不需要打包步骤。
  const api = { getPeriod, shiftPeriod, summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiaryStatistics = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
