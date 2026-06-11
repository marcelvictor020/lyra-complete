@echo off
REM LYRA Setup Script for Windows
REM This script sets up everything you need

echo.
echo ======================================
echo LYRA Setup for Windows
echo ======================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed
    echo Download from: https://nodejs.org
    echo Then run this script again
    pause
    exit /b 1
)

echo ✓ Node.js found: 
node --version
echo.

REM Install dependencies
echo Installing dependencies...
npm install
if errorlevel 1 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)

echo ✓ Dependencies installed
echo.

REM Create .env file if it doesn't exist
if not exist .env (
    echo Creating .env file...
    (
        echo ANTHROPIC_API_KEY=sk-ant-FMjIY5PE0ZTYGm2aElEBOMUlnemsouybrCF_RUemg5A64IHrkFLNL8O3_erbqhqqK3qBzcTzFp4EU7dm4WTQ4Q-jaNnlAAA
        echo MANTLE_RPC_MAINNET=https://rpc.mantle.xyz
        echo MANTLE_RPC_TESTNET=https://rpc.sepolia.mantle.xyz
        echo NETWORK=mainnet
    ) > .env
    echo ✓ .env file created
) else (
    echo ✓ .env file already exists
)

echo.
echo ======================================
echo Setup Complete!
echo ======================================
echo.
echo Next steps:
echo 1. Run: npm run test-wallet
echo 2. Run: npm run test-prices
echo 3. Run: npm run test-ai
echo 4. Open: lyra.html in your browser
echo.
pause
