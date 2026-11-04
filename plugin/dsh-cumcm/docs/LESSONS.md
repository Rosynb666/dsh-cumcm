# 踩坑记录

写给三个月后的我。每条都是真机撞出来的，不是查来的。

## 1. PowerShell 改源码会把中文写坏（差点发布一个坏插件）

**现象**：`node --check lib/client.js` 报 `SyntaxError: Unexpected token 'catch'`，
打开文件看到 `'tab.title': '鏁版ā鍙?,` —— 中文变乱码，**连收尾的单引号都被吃掉**。

**原因**：`Get-Content`（Windows PowerShell 默认按 GBK/ANSI 解码）读 UTF-8 源文件，
再用 `Set-Content`/`WriteAllLines` 按 UTF-8 写回 —— 一次 GBK→UTF-8 双重转码，
多字节字符的尾字节正好顶掉后面的 ASCII 引号。

**正确做法**：

- 改文件用编辑工具（读写 UTF-8），**不要**用 `Get-Content | Set-Content` 往返；
- 万不得已要在 shell 里改，显式指定编码：
  `Get-Content -Encoding UTF8` + `[System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))`；
- 改完必跑 `node --check`，并扫一遍乱码特征（`锛` `鐨` `涓` `鏄`）。

**代价**：这个错误让已安装的客户端半边坏了两轮，用户刷新也只会看到空白。

## 2. 沙箱里 `spawn` 一定 EPERM，别把它当插件 bug

DSH 的沙箱禁止程序打开命名管道，Node 的 `child_process` 默认 `stdio: 'pipe'`
抓输出就会 `spawn EPERM`。表现是插件「跑不了 python」。

- 测试里不要试图 spawn；
- 真机验证要用无沙箱的上下文（宿主进程本身就是）；
- `node --test` 也会拆子进程，同样 EPERM —— 所以测试文件写成可直接 `node test/x.js` 执行。

## 3. 宿主半边改完要重启，客户端半边靠 HMR

- 改 `lib/index.js`（路由）→ **运行中的宿主不会重载**，新路由 404，必须重启 DSH；
- 改 `lib/client.js` → `client-hmr` 会 `stat` 轮询并在几秒内推新 rev，
  可用 `GET /plugins/events`（SSE）核对 rev 是否变化；
- 新装插件时 loader 会热插入宿主半边，但浏览器要**刷新一次**才会执行新的客户端模块。

## 4. MiKTeX 的「包数据库被锁」常常是假警报

`%LOCALAPPDATA%\MiKTeX\miktex\log` 不存在或不可写时，MiKTeX 会把它报成
「package database is locked」。先建目录，再谈锁。

## 5. 证据链要分层

「我觉得能跑」不算证据。可用的分层：

1. 语法：`node --check`；
2. 契约：桩环境跑注册流程，断言 id/kind/key 一致；
3. 渲染：真实 React SSR，首屏不崩；
4. 集成：真机 HTTP 打接口，看 status/run/pdf；
5. 产物：PDF 页数与截图。

前四层机器都能验，第五层要人眼 —— 所以别拿第四层冒充第五层。
