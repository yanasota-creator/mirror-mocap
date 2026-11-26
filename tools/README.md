# 開発用の道具（tools/）

アプリを使うだけなら、このフォルダは必要ありません。動作確認をする人（AI のセッションを含む）向けです。

| 道具 | 中身 | 使い方 |
|---|---|---|
| `build.py` | `src/` のファイルをつなぎ合わせて `index.html` を作る（Python の標準機能だけ） | `python3 tools/build.py`（`--check` で、組み立て済みかどうかだけ確認） |
| `webtest/smoke.js` | Web版をブラウザ（Playwright の Chromium）で自動操作して、主な機能を確かめるテスト。結果を ○／× で出す | 下の「Web版のテスト」 |
| `unity-stubs/` | Unity がなくても `MirrorMocapReceiver.cs` のコンパイルを確かめるための、Unity と UniVRM の簡易部品（スタブ） | `tools/unity-stubs/check.sh`（`mono-mcs` が必要） |
| `test_bridge.py` | ブリッジ（bridge.py）の自動テスト。接続できるページ・接続コード・壊れたデータ・上限など15項目 | `python3 tools/test_bridge.py` |
| `osc_log.py` | VRChat や VSeeFace の代わりに、届いた OSC を表示する受信テスト用プログラム | `python3 tools/osc_log.py native/bridge 30 9000`（30秒、ポート9000） |

## Web版のテスト
```bash
cd tools/webtest && npm install
```
```bash
python3 -m http.server 8765
```
（リポジトリの一番上のフォルダで、別のターミナルで動かしておく）
```bash
cd tools/webtest && node smoke.js
```
カメラの代わりに人物の動画（y4m 形式）を渡すと、体の推定も確かめます。人物写真は `https://storage.googleapis.com/mediapipe-assets/portrait.jpg` などが使えます。y4m への変換は次のとおりです。
```bash
ffmpeg -loop 1 -i portrait.jpg -vf "scale=-2:720,pad=1280:720:(ow-iw)/2:0,format=yuv420p" -t 2 -r 15 cam.y4m
```
```bash
node smoke.js cam.y4m
```

- jsDelivr（CDN）に接続できない環境でも動くように、`node_modules` の同じバージョンのファイルで代わりに応答します
- GPU がない環境では1秒に3〜5コマしか描けません。テストは決まった時間待つのではなく、結果が出るまで待つように書いてあります
