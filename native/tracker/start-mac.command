#!/bin/bash
# ダブルクリックで起動（Mac）。初回だけ、必要な部品をこのフォルダの .venv に入れます。
cd "$(dirname "$0")" || exit 1
if ! command -v python3 > /dev/null; then
  echo "Python が見つかりません。https://www.python.org/downloads/ から入れてください。"
  read -r -p "Enter キーで閉じます"; exit 1
fi
if [ ! -x .venv/bin/python ]; then
  echo "初回の準備をしています。数分かかります..."
  if ! python3 -m venv .venv || ! .venv/bin/python -m pip install -r requirements.txt; then
    echo "部品のインストールに失敗しました。インターネット接続を確認してください。"
    rm -rf .venv; read -r -p "Enter キーで閉じます"; exit 1
  fi
fi
echo "トラッカーを起動します。確認用の窓で q キーを押すと終了します。"
.venv/bin/python tracker.py --preview "$@"
