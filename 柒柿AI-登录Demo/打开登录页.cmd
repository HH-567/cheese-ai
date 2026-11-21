@echo off
chcp 65001 >nul
rem 双击打开登录页。纯静态：不需要装任何东西，也不需要起服务。
setlocal
set "PAGE=%~dp0index.html"
if not exist "%PAGE%" (
  echo 找不到 index.html —— 请把这个 .cmd 和 index.html 放在同一个目录里。
  pause
  exit /b 1
)
echo 正在用默认浏览器打开：%PAGE%
start "" "%PAGE%"
rem 浏览器打开需要一两秒；如果没反应，直接双击 index.html 也一样。
timeout /t 2 >nul
exit /b 0
