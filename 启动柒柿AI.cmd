@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 柒柿AI · 本地启动

set "PORT=%QISHI_PORT%"
if "%PORT%"=="" set "PORT=8000"

echo.
echo  柒柿AI · Cheese AI
echo  ----------------------------------------
echo  启动后浏览器会自动打开 http://127.0.0.1:%PORT%
echo  演示账号：u-a / u-b / u-c，密码 demo1234
echo  关闭窗口即停止服务
echo.

rem ---------- 选择 Python ----------
set "PYCMD="
if defined QISHI_PYTHON set "PYCMD=%QISHI_PYTHON%"
if not defined PYCMD (
  py -3.12 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PYCMD=py -3.12"
)
if not defined PYCMD (
  py -3.11 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PYCMD=py -3.11"
)
if not defined PYCMD (
  py -3 -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PYCMD=py -3"
)
if not defined PYCMD (
  python -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PYCMD=python"
)
if not defined PYCMD (
  echo [错误] 没有找到 Python。请先安装 Python 3.11 或 3.12。
  echo        下载：https://www.python.org/downloads/
  goto :fail
)

rem ---------- 版本提示 ----------
for /f %%v in ('%PYCMD% -c "import sys; print(sys.version_info[0]*100+sys.version_info[1])"') do set "PYVER=%%v"
if not defined PYVER set "PYVER=0"
if %PYVER% GEQ 313 echo [提示] 检测到 Python 3.13+，建议安装 3.11 或 3.12；个别依赖可能没有对应轮子。

rem ---------- 虚拟环境 ----------
if not defined QISHI_NO_VENV (
  if not exist ".venv\Scripts\python.exe" (
    echo [1/3] 创建虚拟环境 .venv ...
    %PYCMD% -m venv .venv
    if errorlevel 1 goto :fail
  )
  set "PYEXE=.venv\Scripts\python.exe"
) else (
  set "PYEXE=%PYCMD%"
)

rem ---------- 依赖 ----------
if defined QISHI_SKIP_INSTALL goto :deps_ready
"%PYEXE%" -c "import fastapi, uvicorn" >nul 2>nul
if not errorlevel 1 goto :deps_ready
echo [2/3] 安装依赖（首次需要几分钟）...
"%PYEXE%" -m pip install --upgrade pip
"%PYEXE%" -m pip install -r backend\requirements.txt
if errorlevel 1 goto :fail
:deps_ready

rem ---------- 前端 ----------
if exist "frontend\dist\index.html" goto :frontend_ready
where npm >nul 2>nul
if errorlevel 1 (
  echo [警告] 未找到 frontend\dist，也没有 npm；页面可能无法打开。
  goto :frontend_ready
)
echo [2/3] 构建前端 ...
pushd frontend
call npm install
call npm run build
popd
:frontend_ready

rem ---------- 启动 ----------
set "ENVARGS="
if exist ".env" set "ENVARGS=--env-file .env"

echo [3/3] 启动服务 ...
if not defined QISHI_NO_BROWSER start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:%PORT%'"

"%PYEXE%" -m uvicorn app.main:app --app-dir backend %ENVARGS% --host 127.0.0.1 --port %PORT%

echo.
echo 服务已退出。按任意键关闭窗口。
pause >nul
exit /b 0

:fail
echo.
echo 启动失败，请查看上面的错误信息。
pause >nul
exit /b 1
