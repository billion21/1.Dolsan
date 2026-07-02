@echo off
echo Starting IoT Command Scheduler Server...
cd /d "d:\workspace\1.Dolsan\project"

REM Try different possible Node.js paths
if exist "C:\Program Files\nodejs\node.exe" (
    echo Using Node.js from Program Files
    "C:\Program Files\nodejs\node.exe" server.js
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
    echo Using Node.js from Program Files x86
    "C:\Program Files (x86)\nodejs\node.exe" server.js
) else (
    echo Trying node from PATH
    node server.js
)

pause
