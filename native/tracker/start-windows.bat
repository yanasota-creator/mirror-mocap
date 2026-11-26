@echo off
chcp 65001 > nul
cd /d "%~dp0"
rem ダブルクリックで起動。初回だけ、必要な部品をこのフォルダの .venv に入れます。
where python > nul 2> nul
if errorlevel 1 (
  echo Python が見つかりません。
  echo https://www.python.org/downloads/ から入れて、インストール画面で「Add python.exe to PATH」にチェックしてください。
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo 初回の準備をしています。数分かかります...
  python -m venv .venv
  if errorlevel 1 ( echo 準備に失敗しました。 & pause & exit /b 1 )
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 ( echo 部品のインストールに失敗しました。インターネット接続を確認してください。 & rmdir /s /q .venv & pause & exit /b 1 )
)
echo トラッカーを起動します。確認用の窓で q キーを押すと終了します。
".venv\Scripts\python.exe" tracker.py --preview %*
pause
