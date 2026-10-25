@echo off
rem 使用前先设置 TOKEN 环境变量，不要把令牌写进脚本。
if "%TOKEN%"=="" (
  echo 请先设置 TOKEN，例如：set TOKEN=change-me-to-a-long-random-string
  exit /b 1
)
set PORT=8080
node server.js
