@echo off
cd /d "C:\Users\pifot\Desktop\Discord"
:loop
echo [%date% %time%] Iniciando Bot... >> logs\execution.log
node bot.js >> logs\execution.log 2>&1
echo [%date% %time%] Bot parou ou caiu. Reiniciando em 5 segundos... >> logs\execution.log
timeout /t 5
goto loop
