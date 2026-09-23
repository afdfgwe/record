# 个人记录

一个无框架、无后端、无外部依赖的个人打卡日历。支持按日期查看、同日多次记录、历史补签和确认删除。

## 使用

直接用现代浏览器打开 `index.html` 即可。为了保持稳定的浏览器存储来源，推荐在项目目录运行：

```powershell
python -m http.server 5173 --bind 127.0.0.1
```

然后打开 `http://127.0.0.1:5173`。每次使用相同的浏览器、地址和端口。

## 补签

在日历中选择过去的日期，点击记录标题右侧的「＋ 补签」，填写实际发生的时间后确认。时间精确到分钟，秒数保存为 `00`，不预填默认时间。

- 今天和未来日期不显示补签入口；绿色打卡按钮始终记录当前时间。
- 一天可以补签多条，按实际发生时间倒序排列，并显示「补签」标记。
- 保存后停留在所选日期；取消不保存，保存失败会保留输入以便重试。
- 使用原有存储键，补签记录增加 `source: "manual"` 字段；旧记录无需迁移，按正常打卡显示。

## 数据与隐私

- 记录写入当前浏览器的 `localStorage`，键为 `personal-records.v1`，不向服务器上传。
- 日期按设备当前本地时区显示；改变时区后，记录可能归入不同日期。
- 更换浏览器、地址或端口不会共享数据。直接打开文件时，各浏览器对本地文件存储的行为可能不同。
- 清除浏览器数据、无痕会话结束可能导致数据丢失。此版本没有账户、同步或备份功能。
- 本地存储不是加密保险箱：共用同一浏览器配置的人可以查看记录。
- 无法读取数据时禁止新增、删除，不自动覆盖原始数据；保存失败时显示错误。

## 测试

需要 Node.js，无需安装依赖：

```powershell
node --test tests/calendar.test.cjs
```

测试覆盖周一起始月历、闰年与跨年、本地日期与午夜、多条记录排序、数据校验、存储错误、补签日期时间校验及旧数据兼容。

### 浏览器验收（可选）

先启动上述本地服务。以下命令使用独立的测试浏览器会话；脚本会清空该会话中本页面的测试数据，请不要用于你的日常浏览器会话。

```powershell
npx --yes --package @playwright/cli playwright-cli -s=record-check open http://127.0.0.1:5173
npx --yes --package @playwright/cli playwright-cli -s=record-check run-code --filename tests/browser-check.js
npx --yes --package @playwright/cli playwright-cli -s=record-check run-code --filename tests/backfill-browser-check.js
npx --yes --package @playwright/cli playwright-cli -s=record-check close
```

浏览器验收覆盖连续点击、刷新保留、历史日期打卡、删除与取消、损坏数据保护、存储读写失败、模拟跨午夜、闰年跨年，以及 320–1280px 布局；截图写入 `output/playwright/`。
