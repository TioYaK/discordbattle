@echo off
:: Inicia o Ascended Bot via PM2 ao fazer login no Windows
cd /d "C:\Users\pifot\Desktop\Discord"
pm2 start ecosystem.config.js
pm2 save --force
