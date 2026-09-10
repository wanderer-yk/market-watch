#!/usr/bin/env python3
"""
market-watch 远程操作工具集 —— 所有 quant-server 操作的唯一入口。

============================================================================
⚠️ 失忆保护（AI 每次动手前必读，避免重复踩坑/写临时脚本瞎试）：
  1. 先读 reports/remote/SOP_REMOTE.md  —— 端到端运维手册，照做别发挥。
  2. 再读 .codebuddy/memory/MEMORY.md     —— 坑位表 + 重跑 SOP 摘要。
  3. 铁律：补跑/重跑只用 `run <日期>`（后台拉生产脚本 run_market_watch.cmd）。
          不要另写 Win32_Process.Create 拉 snapshot.py 半截（日志落盘不可靠）。
          日志唯一真相源 = C:\\workspace\\market-watch.log（GBK 编码，读用 -Encoding Default）。
============================================================================

用法：
  python3 reports/remote/remote.py status [--date YYYY-MM-DD]
  python3 reports/remote/remote.py probe [TOKEN]
  python3 reports/remote/remote.py set-token TOKEN   # 纯写 .env，不 probe（token 由用户保证最新）
  python3 reports/remote/remote.py fetch-token        # 本机从雪球首页取 guest token 并推到服务器 .env（免手动复制）
  python3 reports/remote/remote.py kill-scan          # 精准杀卡死的 snapshot 进程（不动其它 python）
  python3 reports/remote/remote.py run [YYYY-MM-DD] [--sleep 0.8]   # 补跑/重跑统一入口（后台拉 run_market_watch.cmd 全链路）

设计原则（踩坑沉淀，见 MEMORY.md Windows 坑位表）：
  - 所有 PS 脚本走 scp + powershell -File，不用 EncodedCommand（避免 base64 长度/编码问题）
  - 所有上传文件转 CRLF
  - PS 脚本里用 $ 变量，靠 scp 文件模式避免 zsh 吃 $
  - 输出统一 chcp 65001 + UTF-8 解码
  - 后台任务用 Win32_Process.Create（ssh 断开不断连）
  - scan 补跑用 python -u 让进度实时 flush（snapshot 进度在 stderr，默认被缓冲）
"""

import subprocess, argparse, os, datetime, tempfile, textwrap, sys

SSH_HOST = "quant-server"
REMOTE_WORK = r"C:\workspace"
REMOTE_MAIN = r"C:\workspace\trend-trading-agents"
REMOTE_SITE = r"C:\workspace\market-watch"
REMOTE_CMD = r"C:\workspace\market-watch\reports\remote\run_market_watch.cmd"
REMOTE_SNAPSHOT = r"C:\workspace\trend-trading-agents\skills\watchlist\scripts\snapshot.py"
REMOTE_VENV_PY = r"C:\workspace\trend-trading-agents\.venv\Scripts\python.exe"
REMOTE_NODE = r"C:\Program Files\nodejs\node.exe"
XUEQIU_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"


def _ssh_run(cmd, timeout=30, capture=True):
    """执行 ssh 命令，返回 (rc, stdout, stderr)。"""
    r = subprocess.run(['ssh', SSH_HOST, cmd],
                       capture_output=capture, timeout=timeout)
    return r.returncode, r.stdout.decode('utf-8', errors='replace'), r.stderr.decode('utf-8', errors='replace')


def _scp_run_ps(ps_script, timeout=30):
    """把 PS 脚本写到临时文件，scp 上传（CRLF），远程 -File 执行，返回输出。

    这是唯一可靠的本地→远程 PS 执行方式（避开 zsh 吃 $、base64 长度、编码问题）。
    """
    # 本地写 CRLF 文件
    with tempfile.NamedTemporaryFile(mode='w', suffix='.ps1', delete=False, newline='') as f:
        f.write(ps_script.replace('\n', '\r\n'))
        local = f.name
    try:
        remote_ps1 = REMOTE_WORK + r'\_remote_tmp.ps1'
        r = subprocess.run(['scp', local, f'{SSH_HOST}:{remote_ps1}'],
                           capture_output=True, timeout=15)
        if r.returncode != 0:
            return f"[scp failed] {r.stderr.decode('utf-8', errors='replace').strip()}"
        # 远程执行
        r = subprocess.run(['ssh', SSH_HOST, 'powershell', '-NoProfile', '-File', remote_ps1],
                           capture_output=True, timeout=timeout)
        out = r.stdout.decode('utf-8', errors='replace')
        # 过滤 PS 版权头
        lines = [l for l in out.split('\n')
                 if 'Windows PowerShell' not in l and 'go.microsoft.com' not in l]
        return '\n'.join(lines).rstrip()
    except subprocess.TimeoutExpired:
        return "[ERROR] SSH 超时"
    finally:
        os.unlink(local)


# ============================================================
# 子命令：status —— 查 pipeline 全貌
# ============================================================
PS_STATUS = r"""
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$date = '__DATE__'
$mmdd = $date.Substring(5).Replace('-', '')

[Console]::WriteLine("=== PIPELINE PROCESSES ===")
Get-CimInstance Win32_Process | Where-Object {
    $c = ($_.CommandLine -join ' ')
    $c -match 'snapshot\.py|scan-all|diff-cli|candidates-cli|build:report|run_market_watch'
} | ForEach-Object {
    $up = [math]::Round(((Get-Date) - $_.CreationDate).TotalMinutes, 1)
    [Console]::WriteLine("  " + $_.Name + " pid=" + $_.ProcessId + " uptime=" + $up + "min")
}

[Console]::WriteLine("")
[Console]::WriteLine("=== SCAN PROGRESS (market-watch.log) ===")
$scan_log = 'C:\workspace\market-watch.log'
if (Test-Path $scan_log) {
    Get-Content $scan_log -Encoding Default -Tail 8 | ForEach-Object { [Console]::WriteLine("  " + $_) }
} else {
    [Console]::WriteLine("  (no market-watch.log found)")
}

[Console]::WriteLine("")
[Console]::WriteLine("=== FILE STATUS ===")
$raw   = '__MAIN__\data\watchlist\raw\'   + $date + '.json'
$diff  = '__MAIN__\data\watchlist\diff\'  + $date + '.json'
$cand  = '__MAIN__\data\watchlist\derived\' + $date + '-candidates.json'
$daily = '__SITE__\daily\' + $date + '.json'
foreach ($f in @(
    @{Label="raw       "; Path=$raw},
    @{Label="diff      "; Path=$diff},
    @{Label="candidates"; Path=$cand},
    @{Label="daily     "; Path=$daily}
)) {
    if (Test-Path $f.Path) {
        $sz = [math]::Round((Get-Item $f.Path).Length / 1MB, 2)
        $ts = (Get-Item $f.Path).LastWriteTime.ToString("HH:mm:ss")
        [Console]::WriteLine("  [" + $f.Label + "] " + $sz + " MB  " + $ts)
    } else {
        [Console]::WriteLine("  [" + $f.Label + "] MISSING")
    }
}

[Console]::WriteLine("")
[Console]::WriteLine("=== LATEST LOG (C:\workspace\market-watch.log) ===")
$mw_log = 'C:\workspace\market-watch.log'
if (Test-Path $mw_log) {
    Get-Content $mw_log -Encoding Default -Tail 10 | ForEach-Object { [Console]::WriteLine("  " + $_) }
} else {
    [Console]::WriteLine("  (no market-watch.log)")
}

[Console]::WriteLine("")
[Console]::WriteLine("=== MAIN REPO ===")
Push-Location '__MAIN__'
[Console]::WriteLine("  Branch: " + (git branch --show-current))
$behind = (git rev-list --count HEAD..origin/main 2>$null)
if ($behind) { [Console]::WriteLine("  Behind origin: " + $behind + " commits") }
else { [Console]::WriteLine("  Up to date") }
$st = git status --short
if ($st) { [Console]::WriteLine("  Uncommitted: " + @($st).Count + " files") }
else { [Console]::WriteLine("  Clean") }
Pop-Location

[Console]::WriteLine("")
[Console]::WriteLine("=== SITE REPO ===")
Push-Location '__SITE__'
[Console]::WriteLine("  Branch: " + (git branch --show-current))
$behind2 = (git rev-list --count HEAD..origin/main 2>$null)
if ($behind2) { [Console]::WriteLine("  Behind origin: " + $behind2 + " commits") }
else { [Console]::WriteLine("  Up to date") }
$st2 = git status --short
if ($st2) { [Console]::WriteLine("  Uncommitted: " + @($st2).Count + " files") }
else { [Console]::WriteLine("  Clean") }
Pop-Location
"""


def cmd_status(args):
    date = args.date or datetime.date.today().isoformat()
    mmdd = date[5:7] + date[8:10]
    print(f"=== quant-server status @ {datetime.datetime.now().strftime('%H:%M:%S')} (date={date}) ===")
    print()
    script = (PS_STATUS
              .replace("__DATE__", date)
              .replace("__MMDD__", mmdd)
              .replace("__MAIN__", REMOTE_MAIN)
              .replace("__SITE__", REMOTE_SITE)
              .replace("__WORK__", REMOTE_WORK))
    print(_scp_run_ps(script, timeout=30))


# ============================================================
# 子命令：probe —— 测雪球 token 是否有效
# ============================================================
PS_PROBE = r"""
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$token = '__TOKEN__'
$ua = '__UA__'
$code = "const https=require('https');const t='" + $token + "';https.get('https://xueqiu.com/rainbow/ai/abnormal/reasons.json',{headers:{'Cookie':'xq_a_token='+t,'User-Agent':'" + $ua + "','Host':'xueqiu.com'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{console.log('STATUS='+r.statusCode);console.log('BODY='+d.substring(0,300));process.exit(0)})}).on('error',e=>{console.log('ERR='+e.message);process.exit(1)})"
Set-Content -Path C:\workspace\_probe.js -Value $code -Encoding UTF8
& '__NODE__' C:\workspace\_probe.js
"""


def cmd_probe(args):
    """测 token 是否有效。不传 token 则读服务器 .env 的 XUEQIU_TOKEN。"""
    token = args.token
    if not token:
        # 从服务器 .env 读当前 token（token 单一来源 = .env）
        rc, out, err = _ssh_run(
            f'powershell -NoProfile -Command "(Get-Content \'{REMOTE_SITE}\\.env\' | Where-Object {{ $_ -match \'^\\s*XUEQIU_TOKEN\\s*=\' }}).Trim()"',
            timeout=15)
        print("当前 .env 里的 token 行：")
        print(out.strip())
        for line in out.split('\n'):
            s = line.strip()
            if 'XUEQIU_TOKEN' in s and '=' in s:
                token = s.split('=', 1)[1].strip().strip('"').strip("'")
                break
        if not token:
            print("[ERROR] 无法从 .env 提取 token，请手动传：probe <TOKEN>")
            return
        print(f"\n用提取到的 token 测试：{token[:20]}...\n")

    script = (PS_PROBE
              .replace("__TOKEN__", token)
              .replace("__UA__", XUEQIU_UA)
              .replace("__NODE__", REMOTE_NODE))
    print(_scp_run_ps(script, timeout=20))


# ============================================================
# 子命令：set-token —— 更新服务器 .env 里的 XUEQIU_TOKEN
# token 单一来源 = 服务器 C:\workspace\market-watch\.env（snapshot.py 启动时
# 由 _load_env_file 注入 os.environ，不再在代码里写默认值）。set-token 即改 .env。
# ============================================================
PS_SET_TOKEN = r"""
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$path = '__ENV__'
$new = '__TOKEN__'
if (-not (Test-Path $path)) {
    [Console]::WriteLine("[ERROR] .env 不存在: " + $path)
    exit 1
}
$lines = [IO.File]::ReadAllLines($path, [Text.Encoding]::Default)
$replaced = $false
$out = @()
foreach ($l in $lines) {
    if ($l -match '^\s*XUEQIU_TOKEN\s*=') {
        $out += ('XUEQIU_TOKEN=' + $new)
        $replaced = $true
    } else {
        $out += $l
    }
}
if (-not $replaced) {
    $out += ('XUEQIU_TOKEN=' + $new)
}
[IO.File]::WriteAllLines($path, $out, [Text.Encoding]::Default)
[Console]::WriteLine("SET XUEQIU_TOKEN in .env (value hidden): " + $new.Substring(0,15) + "...")
# verify
$g = (Get-Content $path | Where-Object { $_ -match '^\s*XUEQIU_TOKEN\s*=' })
[Console]::WriteLine("NOW: " + ($g -replace '(XUEQIU_TOKEN=).{15}.*', '$1<hidden>'))
"""


def cmd_set_token(args):
    token = args.token
    # 兼容两种输入：纯 token（XqTest... 或 首页 guest 40位hex）或带前缀 xq_a_token=xxx
    if token.startswith('xq_a_token='):
        token = token[len('xq_a_token='):]
    # 两种合法 token：登录态 XqTest... 或 首页 guest（40位hex）。其余仅提示，不阻断。
    _hex40 = len(token) == 40 and all(c in '0123456789abcdef' for c in token)
    if not (token.startswith('XqTest') or _hex40):
        print("[WARN] token 格式不常见，确认是雪球 xq_a_token？继续执行...")

    script = (PS_SET_TOKEN
              .replace("__ENV__", REMOTE_SITE + r'\.env')
              .replace("__TOKEN__", token))
    print(_scp_run_ps(script, timeout=15))
    # 用户约定：给的 token 必是浏览器最新复制的，跳过 probe 验证（纯写 .env）


# ============================================================
# 子命令：fetch-token —— 本机从雪球首页取 guest token 并推到服务器 .env
# 背景：服务器 IP 常被雪球首页（www.xueqiu.com）的阿里云 WAF 拦截，无法自取 token；
#       但本机 IP 通常不被拦，能拿到 guest xq_a_token。该 token 不绑 IP，推到服务器后仍可调通
#       reasons.json（已实测：本机取的 guest token 跨 IP 在服务器上跑通全链路）。
#       故由本机取后下发，免去手动从浏览器复制 cookie。
# ============================================================
def cmd_fetch_token(args):
    """本机访问雪球首页取 guest xq_a_token，推送到服务器 .env（免手动复制）。"""
    import requests as _req
    try:
        r = _req.get("https://www.xueqiu.com/",
                     headers={"user-agent": XUEQIU_UA, "Connection": "close"},
                     timeout=(8, 15))
        token = r.cookies.get("xq_a_token")
    except Exception as e:
        print(f"[ERROR] 本机访问雪球首页失败: {e}")
        return
    if not token:
        print("[ERROR] 首页未返回 xq_a_token（可能本机也被 WAF 拦截）。请改用 remote.py set-token 手动提供。")
        return
    print(f"[fetch-token] 本机获取 guest token 成功（长度 {len(token)}），推送到服务器 .env ...")
    cmd_set_token(argparse.Namespace(token=token))
    print("[fetch-token] 完成。可 remote.py probe 验证，或 remote.py run <日期> 补跑。")


# ============================================================
# 子命令：kill-scan —— 精准杀掉服务器上卡死的 snapshot 进程
# （只杀命令行含 snapshot.py 的进程，不动其它 python 服务）
# ============================================================
PS_KILL_SCAN = r"""
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'snapshot\.py' }
if (-not $procs) {
    [Console]::WriteLine("No snapshot.py process running.")
} else {
    foreach ($p in $procs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        [Console]::WriteLine("KILLED pid=" + $p.ProcessId)
    }
    [Console]::WriteLine("Done. (only snapshot.py processes were targeted)")
}
"""


def cmd_kill_scan(args):
    print(_scp_run_ps(PS_KILL_SCAN, timeout=15))


# ============================================================
# 子命令：run —— 后台跑 run_market_watch.cmd 全链路（补跑/重跑统一入口）
# ============================================================
PS_RUN = r"""
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$cmd = 'cmd /c __CMD__ __DATE__ __SLEEP__'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$cmd}
if ($r.ReturnValue -eq 0) {
    [Console]::WriteLine("STARTED pid=" + $r.ProcessId)
    [Console]::WriteLine("全链路日志: C:\workspace\market-watch.log")
    [Console]::WriteLine("查进度: python3 reports/remote/remote.py status --date __DATE__")
} else {
    [Console]::WriteLine("[ERROR] Win32_Process.Create failed ReturnValue=" + $r.ReturnValue)
}
"""


def cmd_run(args):
    date = args.date or datetime.date.today().isoformat()
    sleep = args.sleep
    script = (PS_RUN
              .replace("__CMD__", REMOTE_CMD)
              .replace("__DATE__", date)
              .replace("__SLEEP__", str(sleep))
              .replace("__MAIN__", REMOTE_MAIN))
    print(_scp_run_ps(script, timeout=15))


# ============================================================
# 子命令：build —— raw 已存在，跑后续步骤（git push + build:report + site push）
# ============================================================
# cmd 模板：跳过 scan，直接走 build + push
BUILD_CMD_TEMPLATE = r"""@echo off
setlocal enabledelayedexpansion
set MAIN_REPO=C:\workspace\trend-trading-agents
set SITE_REPO=C:\workspace\market-watch
set LOG=C:\workspace\build___MMDD__.log
set PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%
set MAIN_TRIES=0
set SITE_TRIES=0
set TODAY=__DATE__

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] ===== build-only start (target=!TODAY!) =====>> "%LOG%"
cd /d "%MAIN_REPO%"

::: diff + candidates（build:report 依赖这两个中间文件）
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] diff + candidates...>> "%LOG%"
call npm run diff -- --date "!TODAY!" >> "%LOG%" 2>&1
if !errorlevel! neq 0 goto :build_fail
call npm run candidates -- --date "!TODAY!" >> "%LOG%" 2>&1
if !errorlevel! neq 0 goto :build_fail

::: build:report --date
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] build:report --date !TODAY!...>> "%LOG%"
call npm run build:report -- --in data/watchlist --out "%SITE_REPO%" --date "!TODAY!" >> "%LOG%" 2>&1
if !errorlevel! neq 0 goto :build_fail

::: build:report full
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] build:report (full)...>> "%LOG%"
call npm run build:report -- --in data/watchlist --out "%SITE_REPO%" >> "%LOG%" 2>&1
if !errorlevel! neq 0 goto :build_fail

:::: git push main repo (build finished; commit outside () block)
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] Push main repo data...>> "%LOG%"
cd /d "%MAIN_REPO%"
git add data\ >> "%LOG%" 2>&1
git diff --cached --quiet
if !errorlevel! equ 0 goto main_no_change
git commit -m "data: !TODAY!" --quiet >> "%LOG%" 2>&1
git push --quiet >> "%LOG%" 2>&1
if !errorlevel! neq 0 set MAIN_TRIES=0 & goto :main_push_retry
:main_no_change

::: git push site repo
cd /d "%SITE_REPO%"
git add daily\ series\ meta.json *.json >> "%LOG%" 2>&1
git diff --cached --quiet
if !errorlevel! equ 0 goto site_no_change
git commit -m "data: !TODAY!" --quiet >> "%LOG%" 2>&1
git push --quiet >> "%LOG%" 2>&1
if !errorlevel! neq 0 set SITE_TRIES=0 & goto :site_push_retry
:site_no_change

:: push retry (rebase then push again, capped at 3 tries to avoid infinite loop)
:main_push_retry
set /a MAIN_TRIES+=1
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] main push failed (try %MAIN_TRIES%), pull --rebase and retry>> "%LOG%"
cd /d "%MAIN_REPO%"
git pull --rebase --quiet >> "%LOG%" 2>&1
git push --quiet >> "%LOG%" 2>&1
if !errorlevel! equ 0 goto :main_no_change
if %MAIN_TRIES% geq 3 goto :build_fail
goto :main_push_retry

:site_push_retry
set /a SITE_TRIES+=1
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] site push failed (try %SITE_TRIES%), pull --rebase and retry>> "%LOG%"
cd /d "%SITE_REPO%"
git pull --rebase --quiet >> "%LOG%" 2>&1
git push --quiet >> "%LOG%" 2>&1
if !errorlevel! equ 0 goto :site_no_change
if %SITE_TRIES% geq 3 goto :build_fail
goto :site_push_retry

for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] ===== build-only done (target=!TODAY!) =====>> "%LOG%"
exit /b 0

:build_fail
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set TS=%%a
echo [!TS!] build-only FAILED at step (target=!TODAY!)>> "%LOG%"
exit /b 1
"""

PS_BUILD = r"""
chcp 65001 > $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='cmd /c __WORK__\_build.cmd'}
if ($r.ReturnValue -eq 0) {
    [Console]::WriteLine("STARTED pid=" + $r.ProcessId)
    [Console]::WriteLine("build 日志: __WORK__\build___MMDD__.log")
    [Console]::WriteLine("查进度: python3 reports/remote/remote.py status --date __DATE__")
} else {
    [Console]::WriteLine("[ERROR] Win32_Process.Create failed ReturnValue=" + $r.ReturnValue)
}
"""


def cmd_build(args):
    date = args.date
    mmdd = date[5:7] + date[8:10]
    cmd_content = (BUILD_CMD_TEMPLATE
                   .replace("__DATE__", date)
                   .replace("__MMDD__", mmdd))
    # scp 上传 cmd（CRLF）
    with tempfile.NamedTemporaryFile(mode='w', suffix='.cmd', delete=False, newline='') as f:
        f.write(cmd_content.replace('\n', '\r\n'))
        local = f.name
    try:
        remote_cmd = REMOTE_WORK + r'\_build.cmd'
        subprocess.run(['scp', local, f'{SSH_HOST}:{remote_cmd}'],
                       capture_output=True, timeout=15)
    finally:
        os.unlink(local)
    # 后台启动
    script = (PS_BUILD
              .replace("__WORK__", REMOTE_WORK)
              .replace("__MMDD__", mmdd)
              .replace("__DATE__", date))
    print(_scp_run_ps(script, timeout=15))


# ============================================================
# 入口
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        description="market-watch 远程操作工具集",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""
        示例：
          remote.py status                        # 查今天状态
          remote.py status --date 2026-08-10      # 查指定日期
          remote.py probe                         # 测当前 token
          remote.py probe XqTestabc123...         # 测指定 token
          remote.py set-token XqTestabc123...     # 更新 token
          remote.py run 2026-08-10                # 后台跑全链路（补跑/重跑统一入口）
          remote.py build 2026-08-10              # raw 已存在，只跑 build+push
        """))
    sub = parser.add_subparsers(dest='command', required=True)

    p_status = sub.add_parser('status', help='查 pipeline 状态')
    p_status.add_argument('--date', default=None, help='日期 YYYY-MM-DD')
    p_status.set_defaults(func=cmd_status)

    p_probe = sub.add_parser('probe', help='测雪球 token 是否有效')
    p_probe.add_argument('token', nargs='?', default=None, help='token（不传则读 run_market_watch.cmd 现有的）')
    p_probe.set_defaults(func=cmd_probe)

    p_set = sub.add_parser('set-token', help='更新 run_market_watch.cmd 的 token')
    p_set.add_argument('token', help='新 token')
    p_set.set_defaults(func=cmd_set_token)

    p_fetch = sub.add_parser('fetch-token',
                             help='本机从雪球首页取 guest token 并推到服务器 .env（免手动复制）')
    p_fetch.set_defaults(func=cmd_fetch_token)

    p_kill = sub.add_parser('kill-scan', help='精准杀掉卡死的 snapshot 进程（不动其它 python）')
    p_kill.set_defaults(func=cmd_kill_scan)

    p_run = sub.add_parser('run', help='后台跑 run_market_watch.cmd 全链路（补跑/重跑统一入口）')
    p_run.add_argument('date', nargs='?', default=None, help='日期 YYYY-MM-DD（默认今天）')
    p_run.add_argument('--sleep', type=float, default=0.8, help='请求间隔秒数（默认 0.8）')
    p_run.set_defaults(func=cmd_run)

    p_build = sub.add_parser('build', help='raw 已存在，只跑 build:report + git push')
    p_build.add_argument('date', help='日期 YYYY-MM-DD')
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
