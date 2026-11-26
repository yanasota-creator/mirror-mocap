#!/bin/bash
# ダブルクリックで起動（Mac）。追加の部品は要りません（Python だけ）。
cd "$(dirname "$0")" || exit 1
if ! command -v python3 > /dev/null; then
  echo "Python が見つかりません。https://www.python.org/downloads/ から入れてください。"
  read -r -p "Enter キーで閉じます"; exit 1
fi
echo "ブリッジを起動します。このウィンドウを閉じると止まります。"
python3 bridge.py "$@"
