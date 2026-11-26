@echo off
chcp 65001 > nul
cd /d "%~dp0"
rem ダブルクリックで起動。追加の部品は要りません（Python だけ）。
where python > nul 2> nul
if errorlevel 1 (
  echo Python が見つかりません。
  echo https://www.python.org/downloads/ から入れて、インストール画面で「Add python.exe to PATH」にチェックしてください。
  pause
  exit /b 1
)
echo ブリッジを起動します。この窓を閉じると止まります。
echo スマホなど別の機器から VMC を受け取るときは、このファイルの最後の行の --vmc-in-lan の前の rem を消してください。
python bridge.py %*
rem python bridge.py --vmc-in-lan %*
pause
