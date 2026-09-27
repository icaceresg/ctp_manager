@echo off
chcp 65001 >nul
title CTP Manager
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instala la version 22 o superior desde https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, solo la primera vez...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

set OPEN_BROWSER=1
call npm start
pause
