@echo off
cd /d "%~dp0"
echo Starting Law & Order Watch Tracker local server...
echo.
echo Open this on this PC:
echo   http://localhost:8080/law_order_tracker_app/
echo.
echo To use it on your phone, connect your phone to the same Wi-Fi and open:
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /c:"IPv4 Address"') do echo   http://%%A:8080/law_order_tracker_app/
echo.
echo Keep this window open while using the app.
echo.
python -m http.server 8080
pause
