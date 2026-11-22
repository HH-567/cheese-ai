@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "HTML=%~dp0pitch\demo-main-response\demo-standalone.html"
if not exist "%HTML%" set "HTML=%~dp0pitch\demo-standalone.html"
if not exist "%HTML%" (
  echo 未找到离线 Demo 文件：
  echo   pitch\demo-main-response\demo-standalone.html
  pause
  exit /b 1
)
start "" "%HTML%"
