@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "%~dp0"

if not exist ".env" (
    echo.
    echo  ERROR: No existe el archivo .env
    echo.
    echo  Crea un archivo llamado ".env" en esta carpeta con el siguiente contenido:
    echo.
    echo  ANTHROPIC_API_KEY=sk-ant-...
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Instalando dependencias...
    npm install
    echo.
)

echo.
echo  Iniciando Revisor de CVs...
echo  Abre tu navegador en: http://localhost:3000
echo.
npm start
