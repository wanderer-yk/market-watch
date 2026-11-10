@echo off
setlocal enabledelayedexpansion
set MAIN_PUSH_TRIES=0
set MAIN_DERIVED_TRIES=0
set SITE_PUSH_TRIES=0
set MAIN_REPO=C:\workspace\trend-trading-agents
set SITE_REPO=C:\workspace\market-watch
set WATCHLIST_DIR=%MAIN_REPO%\data\watchlist
set LOG=C:\workspace\market-watch.log
set PATH=C:\Program Files\nodejs;%APPDATA%\npm;%USERPROFILE%\.pyenv\pyenv-win\versions\3.11.9;%PATH%
set TRADING_PYTHON=%MAIN_REPO%\.venv\Scripts\python.exe
:: ⚠️ 唯一真源：生产调度全链路只有这一份 run_market_watch.cmd（服务器夜跑的就是它，
:: tta 仓库 scripts/ 下的旧孪生已于 2026-11-04 删除，勿再复制回来）。
:: 改动调度契约（成功判定=产物文件存在）须同步 tta scripts/verify_pipeline.sh。
:: npm 的 errorlevel 在 cmd 下不可靠，一律以「产物文件是否存在」判定成败。

:: ============================================================
:: ???????????????????????
::   ????: run_market_watch.cmd [YYYY-MM-DD] [sleep]
::     ?????       -> ??????????????? MarketWatch19/23??
::     ??????       -> ????y?????????????????????????????
::   ??:   run_market_watch.cmd 2026-07-30 0.8
:: ============================================================
set TARGET_DATE=
set SLEEP=0.3
if not "%~1"=="" set TARGET_DATE=%~1
if not "%~2"=="" set SLEEP=%~2
if "%TARGET_DATE%"=="" (
  for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"`) do set TARGET_DATE=%%a
)
set TODAY=%TARGET_DATE%

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] ===== market-watch start (target=!TODAY!, sleep=!SLEEP!) =====>> "%LOG%"
cd /d "%MAIN_REPO%"

:: --- ????????????????????????????? ---
set DATA_DATE=
for /f "delims=" %%a in ('dir /b /o-n "%MAIN_REPO%\data\watchlist\raw\*.json" 2^>nul') do if not defined DATA_DATE set DATA_DATE=%%~na
if "!DATA_DATE!"=="!TODAY!" goto :already_done

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] git sync (stash -u recoverable + pull)>> "%LOG%"
:: 旧写法 checkout -- . + clean -fdq 会不可逆抹掉未提交/未跟踪文件；stash -u 效果
:: 相同（pull 干净落地）但可 git stash pop 找回。误删事故防线。
git stash push -u -q -m "nightly auto-stash !TODAY!" >nul 2>&1
:: 留痕：stash 真吞了东西时日志可见（恢复入口 = git stash pop），空仓时此行无输出
git stash list -n 1 >> "%LOG%" 2>&1
git pull --rebase --quiet >> "%LOG%" 2>&1
:: 立即存 rc：下面的 TS for-loop 会重置 errorlevel，:git_pull_fail 里读 !errorlevel! 恒为 0（误导排障）
set PULL_RC=!errorlevel!
if !PULL_RC! neq 0 goto :git_pull_fail
:: 再校验 snapshot.py 可编译（防编码/语法损坏白跑 30 分钟）
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] syntax check snapshot.py>> "%LOG%"
"%MAIN_REPO%\.venv\Scripts\python.exe" -m py_compile "%MAIN_REPO%\skills\watchlist\scripts\snapshot.py" >> "%LOG%" 2>&1
if !errorlevel! neq 0 goto :syntax_fail
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] git sync + syntax OK>> "%LOG%"

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
:: --- 生产前门禁：管线逻辑自检（防坏代码上线污染数据）---
:: 设计本意：用假 raw 跑真实 diff/candidates 断言产物齐全，坏代码则中止不抓数据。
:: ⚠️ 暂禁用：verify_pipeline.ps1 依赖 WATCHLIST_DIR 环境变量跨 `npm run` 嵌套传递，
::   实测在 powershell→npm.cmd→node 三层下不可靠（diff-cli 读不到 tmp 假 raw，总去默认路径），
::   导致门禁在 Windows 上永远 FAIL。门禁价值在 diff-cli 支持 --watchlist-dir 参数或
::   WATCHLIST_DIR 可靠传递后再启用。改代码时的质量保障改由本地/CI `npm run verify` 承担。
:: TODO: 修 verify 跨平台 + WATCHLIST_DIR 传递后，此处改回阻塞门禁。
:: echo [!TS!] pipeline self-check (verify)>> "%LOG%"
:: powershell -NoProfile -ExecutionPolicy Bypass -File "%MAIN_REPO%\scripts\verify_pipeline.ps1" -Date "!TODAY!" >> "%LOG%" 2>&1
:: if !errorlevel! neq 0 (
::   echo [!TS!] pipeline self-check FAILED, abort before snapshot (bad code pushed?)>> "%LOG%"
::   goto :scan_fail
:: )
echo [!TS!] pipeline self-check SKIPPED (verify gate temporarily disabled, see TODO above)>> "%LOG%"

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] snapshot (python -u foreground, hard timeout 3h via outer guard)>> "%LOG%"
:: 前台直跑 python（避免 Start-Process -Redirect -NoNewWindow 在 SSH 非交互下卡/挂，
:: 以及 SCAN_RC_FILE 临时文件传递退出码不可靠导致误判 snapshot 失败）。
:: 超时保护交给外层：若 3h 仍未结束，由 scheduled task 的"停止任务"兜底。
"%MAIN_REPO%\.venv\Scripts\python.exe" -u "%MAIN_REPO%\skills\watchlist\scripts\snapshot.py" --date "!TODAY!" --concurrency 2 --sleep "!SLEEP!" >> "%LOG%" 2>&1
set SCAN_EXIT=!errorlevel!
if !SCAN_EXIT! neq 0 goto :scan_fail

:diff_stage
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] diff (--date !TODAY!)>> "%LOG%"
call npm run diff -- --date "!TODAY!" >> "%LOG%" 2>&1
:: npm 在 cmd 下的 errorlevel 不可靠（常因无关 stderr 返回非 0），改以输出文件是否生成判断成败
if not exist "%WATCHLIST_DIR%\diff\!TODAY!.json" (
  echo [!TS!] diff output missing, treat as FAIL>> "%LOG%"
  goto :scan_fail
)
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] candidates (--date !TODAY!)>> "%LOG%"
call npm run candidates -- --date "!TODAY!" >> "%LOG%" 2>&1
:: 同上：以输出文件存在性为准
if not exist "%WATCHLIST_DIR%\derived\!TODAY!-candidates.json" (
  echo [!TS!] candidates output missing, treat as FAIL>> "%LOG%"
  goto :scan_fail
)
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] snapshot+diff+candidates OK>> "%LOG%"

:: --- ??????scan-all errorlevel ?????? Node.js ???????????????? 0 ---
:: ???????? raw ????????????????
set /a RAW_RETRY=0
:raw_check
if exist "%MAIN_REPO%\data\watchlist\raw\!TODAY!.json" goto :real_scan_ok
set /a RAW_RETRY+=1
if !RAW_RETRY! leq 6 (timeout /t 5 /nobreak >nul & goto :raw_check)
if !SCAN_EXIT! neq 0 (
  echo [!TS!] scan-all exited !SCAN_EXIT! and raw missing=!TODAY!>> "%LOG%"
)
goto :scan_fail

:real_scan_ok

echo [!TS!] scan-all OK>> "%LOG%"

if not exist "%MAIN_REPO%\data\watchlist\raw\!TODAY!.json" goto :fresh_fail

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] Freshness OK: !TODAY!>> "%LOG%"

echo [!TS!] Push main repo data...>> "%LOG%"
cd /d "%MAIN_REPO%"
git add data\
git diff --cached --quiet
if !errorlevel! equ 0 goto :main_no_change
git commit -m "data: !TODAY!" --quiet >> "%LOG%" 2>&1
:main_push_retry
git pull --rebase --quiet >> "%LOG%" 2>&1
git push --quiet >> "%LOG%" 2>&1
if !errorlevel! equ 0 goto :main_no_change
set /a MAIN_PUSH_TRIES+=1
if !MAIN_PUSH_TRIES! geq 3 goto :scan_fail
echo [!TS!] main push rejected, pull --rebase + retry (!MAIN_PUSH_TRIES!/3)>> "%LOG%"
goto :main_push_retry
:main_no_change
echo [!TS!] Main repo data push OK>> "%LOG%"

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
call npm run build:report -- --in data/watchlist --out "%SITE_REPO%" --date "!TODAY!" >> "%LOG%" 2>&1
:: 以 daily/<date>.json 是否生成判断增量构建成败（npm errorlevel 不可靠）
if not exist "%SITE_REPO%\daily\!TODAY!.json" (
  echo [!TS!] daily/!TODAY!.json missing after incremental build, treat as FAIL>> "%LOG%"
  goto :scan_fail
)
call npm run build:report -- --in data/watchlist --out "%SITE_REPO%" >> "%LOG%" 2>&1
:: 全量重算（density/meta）即便因无关 stderr 返回非 0 也不致命：daily 已生成即核心交付达成，仅记 warning
if !errorlevel! neq 0 echo [!TS!] WARN: full build returned non-zero (likely harmless python stderr), daily already built>> "%LOG%"

:: build 会更新 MAIN_REPO 的派生数据（如 fitness-history.json），但 main push 在 build 之前已执行，
:: 故此处补推一次 MAIN_REPO，捕获 build 产出的派生文件变更，避免每日累积未提交改动。
cd /d "%MAIN_REPO%"
git add data\
git diff --cached --quiet
if !errorlevel! equ 0 goto :main_derived_no_change
git commit -m "data: !TODAY! (derived)" --quiet >> "%LOG%" 2>&1
:main_derived_push_retry
git pull --rebase --quiet >> "%LOG%" 2>&1
git push --quiet >> "%LOG%" 2>&1
if !errorlevel! equ 0 goto :main_derived_no_change
set /a MAIN_DERIVED_TRIES+=1
if !MAIN_DERIVED_TRIES! geq 3 goto :scan_fail
echo [!TS!] main derived push rejected, pull --rebase + retry (!MAIN_DERIVED_TRIES!/3)>> "%LOG%"
goto :main_derived_push_retry
:main_derived_no_change
echo [!TS!] Main repo derived data push OK>> "%LOG%"

cd /d "%SITE_REPO%"
git add daily\ series\ meta.json *.json
git diff --cached --quiet
if !errorlevel! equ 0 goto :site_no_change
git commit -m "data: !TODAY!" --quiet >> "%LOG%" 2>&1
:site_push_retry
git pull --rebase --quiet >> "%LOG%" 2>&1
git push --quiet >> "%LOG%" 2>&1
if !errorlevel! equ 0 goto :site_no_change
set /a SITE_PUSH_TRIES+=1
if !SITE_PUSH_TRIES! geq 3 goto :scan_fail
echo [!TS!] site push rejected, pull --rebase + retry (!SITE_PUSH_TRIES!/3)>> "%LOG%"
goto :site_push_retry
:site_no_change
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] ===== market-watch done (target=!TODAY!) =====>> "%LOG%"
exit /b 0

:already_done
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] Skip: !TODAY! data already exists>> "%LOG%"
exit /b 0

:fresh_fail
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] Skip: freshness check failed missing raw=!TODAY!>> "%LOG%"
exit /b 0

:git_pull_fail
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] git pull FAILED (rc=!PULL_RC!), abort to avoid scanning stale code>> "%LOG%"
exit /b 1

:syntax_fail
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] snapshot.py syntax check FAILED, abort (avoid scanning with broken code)>> "%LOG%"
exit /b 1

:scan_fail
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] scan FAILED (exit=!SCAN_EXIT!, target=!TODAY!)>> "%LOG%"
exit /b 1
