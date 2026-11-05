# Mirror Mocap PC版（Python トラッカー ＋ Unity）

Web版と同じ「内蔵カメラで体・顔・指を推定してVRMアバターを動かす」を、PCアプリとして動かす版です。

```
[カメラ] → tracker.py（Python / MediaPipe） --UDP 127.0.0.1:39540--> Unity（MirrorMocapReceiver.cs が VRM を動かす）
```

- **推定（AI）**：Python の `tracker.py` が担当します。体・顔・手の3つのAIをMediaPipe内部で並列に動かします
- **表示**：Unity が担当します。モデルの髪やスカートの揺れは、UniVRM の揺れもの機能がそのまま効きます
- **つなぎ方**：同じPCの中で、UDP（軽い通信方式）を使って1回あたり約2KBのデータを送ります

> **状態（2026-11-05時点）**：`tracker.py` は、この開発環境で動画ファイルを入力にして、送信まで動作確認済みです。
> Unity側の `MirrorMocapReceiver.cs` は、Unityの代わりの簡易部品とのコンパイルだけ確認しています。**実際のUnityではまだ一度も動かしていません。**

---

## 1. トラッカー（Python）の準備

1. Python 3.10〜3.12 を入れる（https://www.python.org/downloads/ 。インストール時に「Add python.exe to PATH」にチェック）
2. このフォルダの `tracker` でターミナル（Windowsなら「コマンドプロンプト」）を開いて、必要な部品を入れる

```bash
pip install -r requirements.txt
```

3. 起動する（初回はAIモデル約20MBを自動でダウンロードします）

```bash
python tracker.py --preview
```

`--preview` を付けると、カメラ映像に推定した点を重ねた確認用の窓が出ます。q キーで終了です。

| オプション | 意味 |
|---|---|
| `--camera 1` | 2台目のカメラを使う |
| `--quality light` / `standard` / `high` | 軽量・標準・高精度（体のAIモデルの重さが変わる） |
| `--video 動画.mp4` | カメラの代わりに動画ファイルで試す |
| `--port 39540` | 送信先ポート（Unity側と合わせる） |

## 2. Unity の準備

1. Unity Hub から **Unity 6（6000.0 LTS）** か **2022.3 LTS** を入れ、「3D」テンプレートで新しいプロジェクトを作る
2. UniVRM（UnityでVRMを扱う公式の部品）を入れる
   - https://github.com/vrm-c/UniVRM/releases の最新版から **`VRM-…unitypackage`**（VRM 1.0用）をダウンロードする
   - Unity の画面にドラッグ＆ドロップして「Import」を押す
3. このフォルダの `unity/Assets/MirrorMocap` を、Unityプロジェクトの `Assets` の中にコピーする
4. 使いたい `.vrm` ファイルを Unity の `Assets` にドラッグする（自動でモデルに変換されます。VRM 0.x のモデルも VRM 1.0 に変換されます）
5. 変換されたモデルをシーン（Hierarchy）にドラッグする
6. シーンに置いたモデルを選び、Inspector の「Add Component」で **`MirrorMocapReceiver`** を追加する
7. 再生ボタン（▶）を押してから、`tracker.py` を起動する

## 3. 操作

| 操作 | 内容 |
|---|---|
| C キー | 正面リセット（まっすぐ座った姿勢を「正面」として記憶） |
| M キー | ミラー切り替え |
| Inspector の項目 | ミラー・脚・なめらかさ・ぷるぷる を変更できる |

キーが効かない場合は、Inspector で `MirrorMocapReceiver` の右上の「⋮」メニューから「正面リセット」を選べます。Unity 6 の新しい入力方式だけが有効になっていると、キー操作は効きません。

## 4. うまく動かないとき

| 症状 | 考えられる原因と対処 |
|---|---|
| Unity でモデルが動かない | Console に「UDP 39540 で待ち受け中」と出ているか確認する。tracker.py の `--port` と合わせる。ファイアウォールの許可画面が出たら許可する |
| 体は動くのに顔が動かない／表情が出ない | モデルが VRM 1.0 として読み込まれていない可能性。モデルに `Vrm10Instance` が付いているか確認する |
| 動きがモデルに反映されない（T字のまま） | UniVRM の Control Rig が有効だと上書きされることがある。モデルの Import 設定で Control Rig を使わない設定にする |
| 左右が逆 | Inspector の Mirror を切り替える |
| tracker.py が「カメラを開けません」 | `--camera 1` などに番号を変える。Zoom 等を閉じる |
