@echo off
rem amok [carpeta]  abre una ventana. Dentro de una terminal de amok cambia la carpeta de esa ventana
rem (o abre los archivos que se le pasen); amok -n [carpeta] fuerza una ventana nueva.
setlocal
set "AMOK_EXE=%~dp0node_modules\electron\dist\electron.exe"
if /i "%~1"=="-n" goto launch
if /i "%~1"=="--new" goto launch
if not defined AMOK_IPC goto launch
set ELECTRON_RUN_AS_NODE=1
"%AMOK_EXE%" "%~dp0scripts\amok-send.js" %*
if errorlevel 3 goto fallback
exit /b %errorlevel%
:fallback
set ELECTRON_RUN_AS_NODE=
:launch
set AMOK_IPC=
set AMOK_TOKEN=
start "" "%AMOK_EXE%" "%~dp0." %*
