@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul && (python server.py 8080) || (where py >nul 2>nul && (py server.py 8080) || (echo Python не знайдено. Встановіть з https://www.python.org/downloads/ та поставте галочку "Add to PATH". & pause))
