@echo off
set "GOALPULSE_DIR=%~dp0..\.."
set "GOALPULSE_GOAL=upgrade-node-22"
if exist "/Users/raymondottun/Projects/goalpulse/bin/goalpulse.js" (node "/Users/raymondottun/Projects/goalpulse/bin/goalpulse.js" %* & exit /b %errorlevel%)
goalpulse %*
