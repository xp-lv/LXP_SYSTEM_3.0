@echo off
rem 复制为 start.bat（已被 .gitignore 忽略）后再填入自己的令牌。
if "%TOKEN%"=="" (
  echo 请先设置 TOKEN，例如：set TOKEN=change-me-to-a-long-random-string
  exit /b 1
)
set PORT=8080
node server.js
