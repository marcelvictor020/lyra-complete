@echo off
cd /d "%~dp0"
node server.js > lyra-server.out.log 2> lyra-server.err.log
