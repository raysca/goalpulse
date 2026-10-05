@echo off
set "GOALPULSE_DIR=%~dp0..\.."
set "GOALPULSE_GOAL=ship-team-billing"
if exist "/Users/raymondottun/Projects/goalpulse/bin/goalpulse.js" (node "/Users/raymondottun/Projects/goalpulse/bin/goalpulse.js" %* & exit /b %errorlevel%)
goalpulse %*
