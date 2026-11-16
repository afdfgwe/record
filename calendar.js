/**
 * 日期与持久化基础模块：不访问页面 DOM，也不依赖第三方库。
 * 浏览器通过 window.DiaryCore 使用，Node.js 测试通过 require 引入。
 * 记录结构：{ id: 唯一字符串, timestamp: 毫秒时间戳, source?: 'manual' | 'checkin' }。
 * 旧数据没有 source 字段，仍视为普通打卡；manual 表示补签。
 */

(function (root) {
    'use strict';
    // 所有版本继续使用同一个存储键，避免新增功能后读不到原有记录。
    const STORAGE_KEY = 'personal-records.v1';
    // 日期、时分秒统一补齐两位，使显示格式及日期键保持一致。
    const pad = value => String(value).padStart(2, '0');

    /**
     * 将 Date 对象或毫秒时间戳转换为设备本地日期键 YYYY-MM-DD。
     * 不使用 toISOString().slice(0, 10)：那是 UTC 日期，可能与本地日期相差一天。
     * 日历筛选、补签校验和统计分组统一使用此函数。
     */
    function dateKey(value) {
        const date = new Date(value);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    // 按本地时区显示 HH:mm:ss；存储的时间戳本身不携带显示时区。
    function formatTime(value) {
        const date = new Date(value);
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    /**
     * 生成周一开头、固定六行七列的月历格子（包含相邻月份的日期）。
     * month 使用 Date 的月份约定：0 表示一月，11 表示十二月。
     * 返回 outside 标记供界面弱化非本月日期，不在这里生成 HTML。
     */
    function monthCells(year, month) {
        // 使用中午构造日历格，减少本地午夜夏令时切换对日期生成的影响。
        const first = new Date(year, month, 1, 12);
        // getDay() 的周日是 0，通过换算得到周一为 0、周日为 6 的偏移。
        const offset = (first.getDay() + 6) % 7;
        return Array.from({length: 42}, (_, index) => {
            const date = new Date(year, month, 1 - offset + index, 12);
            return {
                key: dateKey(date),
                day: date.getDate(),
                month: date.getMonth(),
                year: date.getFullYear(),
                outside: date.getMonth() !== month
            };
        });
    }

    /**
     * 校验从 localStorage 读取的 JSON；只有键不存在（null）才代表首次使用。
     * JSON 损坏、结构异常、重复 id 或非法时间戳都抛错，而不是静默丢弃记录。
     * 上层收到错误后会禁用写入，防止用空数组覆盖无法读取的旧数据。
     */
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
        // 只返回已支持的字段，并保留 source 缺省状态，兼容旧记录。
        return data.map(({id, timestamp, source}) => source === undefined ? {id, timestamp} : {id, timestamp, source});
    }

    /**
     * 将过去某天的日期键和 HH:mm 转换为本地时间戳，秒和毫秒固定为 0。
     * now 可由测试注入；实际提交时默认重新获取当前时间，避免跨午夜校验失效。
     * 仅允许过去日期，不允许今天或未来日期；非法输入抛出可直接展示的中文错误。
     */
    function backfillTimestamp(key, time, now = Date.now()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key >= dateKey(now)) {
            throw new Error('只能为过去的日期补签，请重新选择日期。');
        }
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            throw new Error('请选择那次实际发生的时间，精确到分钟。');
        }
        const [year, month, day] = key.split('-').map(Number);
        const [hour, minute] = time.split(':').map(Number);
        // 使用 setFullYear，避免 Date 多参数构造器将 0～99 年自动解释成 1900～1999 年。
        const date = new Date(0);
        date.setFullYear(year, month - 1, day);
        date.setHours(hour, minute, 0, 0);
        // 回读日期与时分：拒绝被 Date 自动归一化的非法日期，以及夏令时跳过的本地时间。
        if (year < 1 || dateKey(date) !== key || date.getHours() !== hour || date.getMinutes() !== minute) {
            throw new Error('该日期或时间在当前时区无效，请重新选择。');
        }
        return date.getTime();
    }

    // filter 先生成新数组，再按时间倒序排列，不改变共享 records 的原顺序。
    function recordsForDate(records, key) {
        return records.filter(record => dateKey(record.timestamp) === key).sort((a, b) => b.timestamp - a.timestamp);
    }

    // 存储对象由调用者传入，便于测试读取异常；异常原样交给界面层处理。
    function loadRecords(storage) {
        return parseRecords(storage.getItem(STORAGE_KEY));
    }

    // setItem 成功返回才算保存成功；不在这里吞掉权限不足或空间耗尽的异常。
    function saveRecords(storage, records) {
        storage.setItem(STORAGE_KEY, JSON.stringify(records));
    }

    // 双环境导出：无需构建即可在浏览器使用，同时支持 Node.js 单元测试。
    const api = {
        backfillTimestamp,
        STORAGE_KEY,
        dateKey,
        formatTime,
        monthCells,
        parseRecords,
        recordsForDate,
        loadRecords,
        saveRecords
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DiaryCore = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
