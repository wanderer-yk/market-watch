# 远程运维 SOP（market-watch / trend-trading-agents）

> 唯一入口：`python3 reports/remote/remote.py <子命令>`
> 服务器：`quant-server`（Windows，`C:\workspace\`）。主仓 `trend-trading-agents`，站点仓 `market-watch`。
> 全链路调度脚本（权威、已验证）：`C:\workspace\market-watch\reports\remote\run_market_watch.cmd`
> 全链路日志（唯一真相源）：`C:\workspace\market-watch.log`

---

## ⚠️ 会话启动必读（防失忆自检清单）

**每次新开会话 / 对话压缩后，动手做任何远程操作前，先按顺序确认：**

1. [ ] 读过本文件（`reports/remote/SOP_REMOTE.md`）
2. [ ] 读过 `.codebuddy/memory/MEMORY.md`（坑位表 + 重跑 SOP 摘要）
3. [ ] 确认 `remote.py` 文件头 docstring 的"失忆保护"段仍是最新版
4. [ ] 记住铁律：**补跑/重跑只用 `run <日期>`**，绝不另写后台拉 snapshot.py 的临时脚本

**如果上下文已丢失（不知道上次跑到哪）：**
```
python3 reports/remote/remote.py status --date <可疑日期>   # 看 market-watch.log 实际进度
```
**别猜、别写新脚本、别手动 ssh 试。** status 已经能回答"在跑没、卡没卡、产物齐没齐"。

---

**为什么要有这份清单**：2026-08-25 曾因未读记忆直接上手，自己造了 `Win32_Process.Create` 拉 snapshot.py 半截 + 各种错误日志文件名，导致后台进程全卡死、空转一小时。根因 = 没先固化 SOP 就临时发挥。此后任何远程操作一律照本文件，禁止即兴。

---

## 0. 铁律（今天踩的坑，永不再犯）

1. **不要另造重跑脚本**。补跑 / 重跑 = 直接 `remote.py run <日期>`。它后台拉起 `run_market_watch.cmd`，走的是和**每个工作日定时任务**完全相同（周一~周五 19:00，见附录）的、已验证的生产路径。任何自己写 `Win32_Process.Create` 拉 `snapshot.py` 半截的做法，都绕开了生产路径、且日志落盘不可靠。
2. **日志只在 `market-watch.log`**。snapshot/diff/candidates/build 全部 `>> market-watch.log 2>&1`。不要去查 `scan_live_*.log` / `scan*.log` 这些不存在/过时的文件名（早期 `rerun-scan` 残留命名，已废弃）。
3. **先看日志，别猜 CPU/进程**。排错第一动作永远是 `status`（它 dump `market-watch.log` 尾部），不是 `Get-CimInstance` 看进程 CPU。
4. **token 由用户保证最新**：400016 首选 `fetch-token`（本机取 guest token 推服务器，免复制）；也可 `set-token` 纯写 `.env`，不 probe。要验证就单独 `probe`（只读）。
5. **路径无空格就不套引号**（`Win32_Process.Create` 的 CommandLine）；cmd 重定向 `>>` 前必须有空格。
6. **上传到 Windows 的 `.cmd`/`.bat` 必须是 CRLF 行尾**。`git pull` 已被 `.gitattributes`(`*.cmd text eol=crlf`) 保成 CRLF，但**手动 `scp` 覆盖服务器 .cmd 时仍必须先在本地转 CRLF**（否则 cmd.exe 解析错乱：注释行 `::` 被当命令执行、变量展开崩、整段脚本废掉）。转法：`python3 -c "open(f).read().replace('\n','\r\n')"` 后 scp。
7. **改完 `remote.py` 也要验**：至少 `python3 reports/remote/remote.py --help` 确认无 SyntaxError/Warning；改了子命令逻辑再 `python3 -c "import ast; ast.parse(open('reports/remote/remote.py').read())"` 静态校验。今天曾因 docstring 里 `\w` 非 raw 字符串触发 SyntaxWarning 未察觉。
8. **`git push` 被拒是常态，不是故障**。服务器每个工作日自动 commit 数据（主控仓 `data: <日期>`、站点仓 `data: <日期>`），本地过一夜必然落后 origin。遇到 `rejected / non-fast-forward` 直接 `git pull --rebase` 再 push，别怀疑、别回滚。
9. **盘中绝不能 `run` 当天日期**。A股 09:30 开盘、15:00 收盘，定时任务设在 19:00（收盘后 4 小时）就是为了让数据齐全。刚开盘/盘中手动 `remote.py run <今天>` 会抓半截数据，直接污染当日产物——**当天数据一律等 19:00 定时任务自动跑**。补跑只用于"过去的日期"。

---

## 0.5 日常巡检（每天早上第一件事）

用户每天会问"检查昨天任务情况"。标准化动作就两步，别自由发挥：

```bash
# 1) 查昨天（或指定日期）完成情况
python3 reports/remote/remote.py status --date <昨天日期>

# 2) 若近期日期不确定，批量扫一遍
for d in 2026-08-27 2026-08-28 2026-08-31; do
  echo "=== $d ==="
  python3 reports/remote/remote.py status --date $d | grep -iE "done|Skip|FAILED|MISSING|Clean|Uncommitted"
done
```

**判读标准**：
- 日志出现 `===== market-watch done (target=<日期>) =====` → ✅ 该日成功
- 出现 `Skip: <日期> data already exists` → ✅ 幂等跳过（数据已有，正常）
- 双仓 `Clean` + `Behind origin: 0` → ✅ 推送完整
- `daily MISSING` + 当天是**周末/节假日** → ✅ **正常**（A股休市，任务不触发，见附录）
- `daily MISSING` + 当天是**工作日** → ❌ 真缺失，走 §1 补跑
- `Uncommitted: N files` → ⚠️ 有产物没提交，见 §5 决策树对应分支

**不要**因为周末没数据就跑去排查——那是设计如此。

---

## 1. 日常补跑单日（最常见场景）

适用：某天数据缺失（如定时任务因 400016/WAF 失败），需补齐。

```bash
# 1) 若 token 过期，用户给新 token 后：
python3 reports/remote/remote.py set-token <新token>      # 纯写 .env，不 probe

# 2) 补跑（后台拉起 run_market_watch.cmd，自动跑全链路+双仓 push）
python3 reports/remote/remote.py run 2026-08-24

# 3) 反复查进度/结果（看 market-watch.log 尾部）
python3 reports/remote/remote.py status --date 2026-08-24

# 4) 确认产物齐全：raw/diff/candidates/daily 全 OK 即完成
```

`run` 的 skip 逻辑：若 `raw/<日期>.json` 已存在，自动跳过不重扫。所以"补跑缺失日"和"重跑某日"都用同一条命令，安全。

---

## 2. 验证 token / 环境

```bash
python3 reports/remote/remote.py probe        # 只读，确认 .env 的 XUEQIU_TOKEN 返回 200
python3 reports/remote/remote.py status        # 看服务器双仓 git 状态 + 最近日志
```

- `probe` 返回 `STATUS: 200` → token 有效。
- 返回 `400016` → token 过期，走 §1 第 1 步换 token。
- 返回 WAF 拦截页（含 `captcha` / `acw_sc__v2`）→ 阿里云风控，需浏览器访问 xueqiu.com 过验证码解封服务器 IP，无法代码解决。

---

## 3. 卡死 / 僵尸进程清理

若 `status` 显示进程残留但日志不再增长（疑似卡死）：

```bash
python3 reports/remote/remote.py kill-scan     # 只杀命令行含 snapshot.py 的进程，不动其它 python 服务
```

清理后重新 `run <日期>`。

---

## 4. raw 已存在但后续步骤没跑（半截失败）

若 `raw/<日期>.json` 已有，但 `diff/candidates/daily` 缺失（snapshot 成功、后续崩）：

```bash
python3 reports/remote/remote.py build 2026-08-24   # 跳过 scan，直接 diff+candidates+build:report+双仓 push
```

（注：`build` 子命令走自己的 `build___MMDD__.log`，非 market-watch.log，但其产物契约与 run 一致。）

---

## 5. 排错决策树

```
status 显示 scan FAILED / 400016
  ├─ probe 返回 400016 → **优先 `fetch-token`**（本机从雪球首页取 guest token 并推到服务器 .env，免手动复制）；或 `set-token <token>` 手动换 → run 重跑
  ├─ probe 返回 WAF 拦截页 → 浏览器过验证码解封 IP → probe 复 200 → run 重跑
  └─ probe 返回 200 但仍失败 → 看 market-watch.log 具体报错
        ├─ push 被拒(rejected/non-fast-forward) → 本地/服务器 git pull --rebase 合入再 push
        │     （run_market_watch.cmd 的 push 段已有 pull --rebase 重试兜底，此支多发生于
        │      手动 git 操作或极端 rebase 冲突；冲突需人工解决后重跑）
        ├─ status 显示 Uncommitted: N files（产物没提交） → 见下方"未提交改动"专段
        ├─ snapshot.py 语法错误 → 本地修 snapshot.py（只许 ASCII 注释）→ push → run 重跑
        ├─ 进程卡死无进展 → kill-scan → run 重跑
```

> **关于 token 自动获取的边界（重要）**：`snapshot.py` 已实现"探针 400016 → 访问雪球首页自动取 guest token 写回 `.env`"；
> 但**服务器 IP 常被雪球首页（www.xueqiu.com）的阿里云 WAF 拦截**，首页返回拦截页、拿不到 cookie，
> 故服务器侧自动取 token 实际不可行（已实测确认）。可行方案是 **`remote.py fetch-token`**：在你本机
> （IP 通常不被拦）取 guest token 并推送到服务器 `.env`，免去手动从浏览器复制。该 guest token 不绑 IP，
> 推到服务器后可正常调通 reasons.json（已实测全链路跑通）。所以 400016 的首选恢复动作是 `fetch-token`，
> 而非手动复制 cookie。

**"未提交改动"专段**（`status` 显示 `Uncommitted: N files`）：

先查是哪个文件，再决定补提交还是修脚本：
```bash
ssh quant-server "cmd /c \"cd /d C:\workspace\trend-trading-agents && git status --short\""
```
- 若是 `data/watchlist/derived/*.json`（如 `fitness-history.json`）→ 说明 build 产出的派生数据
  没被 push。**已于 2026-08-26 修复**：`run_market_watch.cmd` 在 build 之后补了一段
  `Main repo derived data push`（此前 main push 在 build 之前执行，所以 build 更新的派生
  文件永远漏提交）。若修复后又出现，先手动补提交，再查是否新增了别的派生产物：
  ```bash
  ssh quant-server "cmd /c \"cd /d C:\workspace\trend-trading-agents && git add data\\ && git commit -m 'data: <日期> derived' && git push\""
  ```
- 若是脚本文件（`.cmd`/`.py`/`.ps1`）→ 有人/有流程在服务器上直接改了文件没提交，
  违反"git 仓唯一源"。先确认改动是否有价值：有用就提交，是调试残留就
  `git checkout -- <file>` 丢弃。
- ⚠️ 工作区不干净会让下次 `git pull --rebase` 失败 → 定时任务连锁崩，务必当天清掉。
> **关于"生产前门禁"**：`run_market_watch.cmd` 里的 `npm run verify` 自检门禁**已于
> 2026-08-25 暂禁用**——它依赖 `WATCHLIST_DIR` 环境变量跨 powershell→npm→node 三层传递，
> Windows 上不可靠（`diff-cli` 读不到临时假 raw，永远 FAIL）。改代码时的质量保障改由
> **本地/CI `npm run verify`**（mac 用 `verify_pipeline.sh`，Windows 修好 `verify_pipeline.ps1`
> 后可用）承担，**不在线上重跑路径**。线上重跑的是 git 稳定版，不每次自检。
> 参见 MEMORY.md 坑位 #15。
```

---

## 6. 子命令速查

| 命令 | 作用 | 日志去哪看 |
|---|---|---|
| `probe` | 只读测 token 是否 200 | 本地终端直出 |
| `set-token <t>` | 纯写 `.env` 的 XUEQIU_TOKEN | 本地终端直出 |
| `run <日期> [sleep]` | 后台拉 `run_market_watch.cmd` 跑全链路+双仓 push | `market-watch.log` |
| `build <日期>` | 跳过 scan，只跑后续步骤 | `build___MMDD__.log` |
| `kill-scan` | 精准杀 snapshot 僵尸进程 | 本地终端直出 |
| `status [--date D]` | dump market-watch.log 尾部 + 双仓 git 状态 + 产物清单 | 本地终端直出 |

---

## 7. 改完代码后必做（质量保障，勿省）

改 `run_market_watch.cmd` 调度逻辑后，**必须先本地验证再上生产**（历史教训：连续两次线上 FAILED）：

```bash
# ⚠️ 以下 npm 命令必须在【主控仓 trend-trading-agents】目录执行，
#    站点仓 market-watch 没有 package.json 的这些 script，在站点仓跑会报 "Missing script"。
cd /path/to/trend-trading-agents     # 服务器 C:\workspace\trend-trading-agents；本地 ~/workspace/github/trend-trading-agents

npm run verify                        # ① 管线调度冒烟（bash verify_pipeline.sh，假 raw 跑真实 diff/candidates/build）
npm run typecheck                     # ② tsc --noEmit 类型检查
npm run lint                          # ③ eslint src/
npx vitest run                        # ④ 单测（主控仓没有 test script，只有 test:watch/coverage，须直接调 vitest）
```

> ❌ **注意主控仓没有 `npm test` 这个 script**（2026-09-01 核实：只有
> `test:watch`/`coverage`/`lint`/`typecheck`/`diff`/`candidates`/`build:report`/`verify`）。
> 别再写 `npm test`，会报 Missing script。要跑单测用 `npx vitest run`。
>
> 💡 实际最常用的只有 ①`npm run verify`（改调度逻辑后必跑）。主控仓配了 husky
> `prepare`，`git commit` 时会自动跑 verify（git 自带 bash，Windows 上能通，
> 日志里看到 `[verify] PIPELINE_OK` 就是它）—— 所以**提交即验证**，这是最省事的保障。

> **注意**：`run_market_watch.cmd` 的 `--verify` 模式**已于 2026-08-25 删除**——
> 它是 `npm run verify`(bash) 的冗余 Windows 重写且已写坏。不要再在服务器跑
> `cmd /c run_market_watch.cmd --verify`（参数不被识别，会被当成日期去真抓数据）。
> 想离线验管线，直接在主控仓 `npm run verify`。

### 上生产闭环（验证通过后，别漏这步）

改的是**站点仓 `market-watch` 里的 `run_market_watch.cmd`** 时，光本地验证不够，必须让**服务器**用上改后的版本：

```bash
# 1) 本地 commit + push 到 origin
git add reports/remote/run_market_watch.cmd && git commit -m "..." && git push
#    （git push 若被拒：先 git pull --rebase 再 push）

# 2) 服务器拉正式版（关键：别用 scp 直接覆盖！会破坏 CRLF + 留未提交改动）
ssh quant-server "cmd /c \"cd /d C:\workspace\market-watch && git pull --quiet\""

# 3) 确认服务器工作区干净 + cmd 是 CRLF（防定时任务崩）
ssh quant-server "cmd /c \"cd /d C:\workspace\market-watch && git status --short\""
#    → 应无输出；且文件含 CRLF（.gitattributes 已保）

# 4) 轻量冒烟：用一个【已存在 raw 的日期】跑，会走 already_done 分支直接退出，零风险
ssh quant-server 'cmd /c "C:\workspace\market-watch\reports\remote\run_market_watch.cmd" 2026-08-24'
#    → 若报 "命令语法不正确" 说明 CRLF 又坏了；若正常 echo Skip 并 exit /b 0 即 OK
```

> **血泪**：曾 scp 直接覆盖服务器 .cmd（忘了转 CRLF）+ 没让服务器 pull 正式版，
> 导致服务器工作区既有"未提交 scp 改动"又落后 origin， `git pull` 失败。
> 现在一律走"本地 commit → push → 服务器 git pull"正规链路，禁用 scp 覆盖生产脚本。

### 若改的是主控仓（trend-trading-agents）的文件

主控仓文件（`snapshot.py`、`verify_pipeline.ps1`、`dist/*.js` 等）也要同步，否则服务器跑的还是旧版：

```bash
# 1) 判断 dist 是否需要重建：改了 src/*.ts 必须 build，否则服务器跑的仍是旧 dist
cd /path/to/trend-trading-agents && npm run build    # 生成 dist/*.js（若改的是 TS）

# 2) 本地 commit + push
git add <改动文件> && git commit -m "..." && git push
#    git commit 会自动触发 husky pre-commit 跑 npm run verify（见 §7 上方提示）

# 3) 服务器主控仓拉取 + 确认干净
ssh quant-server "cmd /c \"cd /d C:\workspace\trend-trading-agents && git pull --quiet && git status --short\""
#    ⚠️ 主控仓每天自动 commit 数据，本地几乎必然落后 → push 被拒就 git pull --rebase 再 push（铁律 8）

# 4) 冒烟：服务器主控仓跑一次 verify（确认管线在服务器环境通）
ssh quant-server "cmd /c \"cd /d C:\workspace\trend-trading-agents && npm run verify\""
#    → 期望 [verify] PIPELINE_OK
```

---

## 附录：定时任务真相（查错时极易查错任务名）

**不是** `market-watch` / `scan` 之类的名字。`schtasks /query` 默认列表里也容易被忽略。
真实任务名（在 `C:\Windows\System32\Tasks\` 下）：

- **`MarketWatch19`** —— **周一至周五 19:00** 触发，调 `cmd /c C:\workspace\market-watch\reports\remote\run_market_watch.cmd`（无日期参数 → 脚本内部推断今天）
- **`MarketWatch23`** —— **周一至周五 23:00** 触发，同样无参数调用 cmd（**兜底**：19:00 因 400016/WAF/网络失败后的二次机会；数据已存在则 Skip）

> ⚠️ **触发日是"周一~周五"（`ScheduleByWeek` + `DaysOfWeek` 列了 Mon/Tue/Wed/Thu/Fri），
> 不含周六周日**。所以**周末 `status` 查到"无数据 / MISSING"是完全正常的**，不是故障——
> A股周末休市，任务本就不触发。工作日才该有数据。

查任务配置（避免再次用错关键词）：
```bash
ssh quant-server "cmd /c \"type C:\Windows\System32\Tasks\MarketWatch19\""
ssh quant-server "cmd /c \"type C:\Windows\System32\Tasks\MarketWatch23\""
```

**推论**：
- 不手动触发时，**工作日（周一~周五）19:00** 自动跑当天数据（收盘后 4 小时，A股 15:00 收盘，数据齐全）
- **周末无数据 = 正常**，别当故障排查
- 刚开盘/盘中**切勿手动 `remote.py run` 当天日期**——会抓半截数据污染产物
- 若某**工作日** `status` 显示未跑，先检查这两个任务是否被禁用/删除，而非怀疑脚本
- 查 `schtasks` 列表时用 `findstr "MarketWatch"` 而非 `market-watch`（任务名无连字符）
