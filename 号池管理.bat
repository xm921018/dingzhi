@echo off
setlocal
title 互听群号池管理（管理员）
set "PY=C://Users//xuming//.workbuddy//binaries//python//envs//default//Scripts//python.exe"
set "SCRIPT=%~dp0号池管理.py"
cd /d "%~dp0"

:menu
cls
echo ==============================================
echo            互听群号池管理（管理员）
echo ==============================================
echo   1. 查看号池
echo   2. 添加账号（不填歌曲ID = 公益号，不绑单曲）
echo   3. 删除账号
echo   4. 替换某个账号的 CK
echo   5. 改绑歌曲（输入 none = 解除绑定变公益号）
echo   6. 补录/修改通知邮箱
echo   7. 全部验活
echo   8. 手动同步到 GitHub（KV 到 Secrets）
echo   0. 退出
echo ==============================================
set "choice="
set /p choice=请选择并回车:
if "%choice%"=="1" "%PY%" "%SCRIPT%" list & goto end
if "%choice%"=="2" goto add
if "%choice%"=="3" goto del
if "%choice%"=="4" goto setck
if "%choice%"=="5" goto setsong
if "%choice%"=="6" goto setmail
if "%choice%"=="7" "%PY%" "%SCRIPT%" check & goto end
if "%choice%"=="8" "%PY%" "%SCRIPT%" resync & goto end
if "%choice%"=="0" exit /b 0
goto menu

:add
echo.
set "name=" & set "ck=" & set "song="
set /p name=账号名称（如 成员手机号 或 公益-xxx）:
set /p ck=CK（完整cookie 或 裸MUSIC_U值 或 文件路径）:
set /p song=歌曲ID（公益号直接回车留空）:
if "%song%"=="" (
    "%PY%" "%SCRIPT%" add "%name%" "%ck%"
) else (
    "%PY%" "%SCRIPT%" add "%name%" "%ck%" %song%
)
goto end

:del
echo.
set "key="
set /p key=要删除的名称或序号（先选 1 查看号池）:
"%PY%" "%SCRIPT%" del "%key%"
goto end

:setck
echo.
set "key=" & set "ck="
set /p key=要换CK的名称或序号:
set /p ck=新CK（完整cookie 或 裸MUSIC_U值 或 文件路径）:
"%PY%" "%SCRIPT%" setck "%key%" "%ck%"
goto end

:setsong
echo.
set "key=" & set "song="
set /p key=要改绑的名称或序号:
set /p song=歌曲ID（解除绑定输入 none）:
"%PY%" "%SCRIPT%" setsong "%key%" %song%
goto end

:setmail
echo.
set "key=" & set "mail="
set /p key=要补邮箱的名称或序号:
set /p mail=通知邮箱（账号异常时邮件提醒本人）:
"%PY%" "%SCRIPT%" setmail "%key%" "%mail%"
goto end

:end
echo.
pause
goto menu
