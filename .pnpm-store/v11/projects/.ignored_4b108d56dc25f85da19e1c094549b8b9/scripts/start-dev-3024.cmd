@echo off
cd /d "%~dp0.."
call "%~dp0..\node_modules\.bin\next.cmd" dev -p 3024
