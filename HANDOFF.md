# Mirror Mocap 引き継ぎ資料

最終更新：2026-11-25（3回目のセッション）。次のセッション（人でもAIでも）がここから続きを始められるように書いています。

## 1. 何を作ったか

PC内蔵カメラ1台（フルトラッキングなし）で、自分の体・顔（表情）・指の動きを推定して、3Dアバター（VRM）を動かすツールです。

| 版 | 場所 | 状態 |
|---|---|---|
| **Web版**（本体） | `index.html`（1ファイル完結） | 動作確認済み。公開中 |
| **PC版**（試作） | `native/`（Python トラッカー ＋ Unity スクリプト） | トラッカーは確認済み。Unity側はUniVRMのソースと照合済み・**実機では未確認** |

- リポジトリ：https://github.com/yanasota-creator/mirror-mocap
- 公開URL（GitHub Pages、スマホでも使用可）：https://yanasota-creator.github.io/mirror-mocap/

## 2. 利用者について

- 機械科の学生で、エンジニアではありません
- 説明は日本語で、専門用語には一言説明を付けてください
- コマンドを出すときは、先に目的を説明してください
- エラーのときは、まず原因から説明してください
- かわいいアニメ調の人型モデルが好みです（ちびキャラや動物は不採用でした）
- 「重い」「精度」を気にしています。PC版はUnityがいいという意向です
- 顔バレを気にしています（カメラ映像の非表示ロックを付けた。音声認識のように外部に送る機能は初期オフ＋確認を出す）
- 「機能を片っ端から増やしてほしい」という希望があり、3回目のセッションで大量に追加した

## 3. Web版のしくみ（`index.html`）

```
カメラ → Web Worker×3（体/顔/手のAIを並列） → 関節の角度を計算 → ばね式の補間 → three.js + three-vrm で描画
```

| 部分 | 中身 |
|---|---|
| AI | MediaPipe Tasks Vision 0.10.21（jsDelivr から読み込み）。体 = Pose Landmarker（軽量=lite / 標準=full / 高精度=heavy）、顔 = Face Landmarker（表情52種付き）、手 = Hand Landmarker（2本） |
| 並列化 | AIごとに Web Worker を1つ起動する。各Workerは起動直後にGPUとCPUを実測し、速い方を自動で選ぶ。Workerが使えなければ、メインスレッドで動かす（`createMainEngine`） |
| 軽量化 | 手首が映っていないときは手のAIを止め、8コマに1回だけ確認する。軽量モードでは体と手を1コマおきに交互に動かす。描画が35fpsを切ったら3Dの解像度を段階的に下げる。スマホでは最初から軽量モードにする |
| 関節の計算 | 推定した点から骨の向きを出して、関節の回転にする（`aim` / `basisQuat` / `worldFromBasis`）。座標の変換は `conv`、ミラー時の左右入れ替えは `subjSide` |
| 補間 | AIの結果は「目標の角度」として置き、描画するたびに、ばね＋ダンパー（減衰器）で近づける（`easeToTargets`）。「なめらかさ」＝ばねの固さ、「ぷるぷる」＝減衰の弱さ。VRMの揺れもの（spring bone）の強さも「ぷるぷる」に連動 |
| ブレ止め | 点の座標に One Euro フィルターをかける |
| 手が顔に重なったとき | `faceOcclusion` で判定する。顔の前に手 → 頭の向きを維持（最大4秒）。口の近く → 口と笑顔の更新を止める。目の近く → まばたきと視線の更新を止める。顔の向きが1回で25°以上飛んだ値は2回まで捨てる。止めているあいだは上部の「顔」チップがオレンジになる |
| カメラ映像の非表示 | 「カメラ映像を表示」オフで左下の小窓を札だけにする（映像は `visibility: hidden` で隠すだけで再生は続け、推定は止めない）。「表示をロック」中は表示スイッチを無効化し、解除には `confirm` を出す。どちらも保存される。録画は元から3D画面（canvas）だけ |
| 追加機能（3回目のセッション） | 背景（グリーンバック等・画像）、配信モード（Esc で戻る）、PNGスクショ、表情ボタン（1〜5キー）、マイク口パク（AnalyserNode の音量と大まかな周波数）、小物（握ると掴む＝指先と手首の距離から握り具合 `grip` を出す。重力オン/オフ）、BVH書き出し（30fps固定）、PCブリッジ（`native/bridge/bridge.py`：WebSocket → VMC / VRChat OSC）。外部へ出す値は `exportPose`（正規化ボーンのローカル回転、VRM0は180°戻す）と `exportTrackers` |
| 追加機能（続き） | 照明、アクセサリー（`measureHead`：頭のボーン座標系でレイを撃って目の高さ・頭頂・顔の表面を測る。エフェクトの位置にも使う）、エフェクト（Sprite）、カメラ揺れ（描画の直前だけ位置をずらす）、パネルの折りたたみ、ピースで笑顔、VRMA書き出し（`vrmaBinary`：GLBを手書き。公式バリデータでエラー0）と再生（three-vrm-animation を動的 import。**AnimationMixer は値が変わったときしか書かないので使わず、トラックを毎フレーム自分で評価して書く**） |
| 設定の保存 | 設定と最後に選んだモデルを localStorage（そのブラウザだけに残る保存場所）に保存 |
| その他 | 正面リセット、ミラー、脚（膝と足首が見えるときだけ）、録画（.webm）、動画ファイル入力、自分のVRM読み込み、マネキン（オフライン用の予備） |

### 収録モデル（13体）
全部、作者が無料での利用を認めているモデルです。`MODELS` 配列に、URL・サムネイル・クレジットを入れています。

- VRM1サンプル（pixiv, VRM Public License 1.0）
- アリシア・ソリッド（ドワンゴ、ニコニ立体ちゃん利用規約。暴力・性的表現は不可）
- 千駄ヶ谷 篠、千駄ヶ谷 渋、ビビ、ヴィータ、ヴィクトリア、HairSample、Darkness Shibu（VRoid公式サンプル、CC0）
- シェイプル（lowteq、CC0）
- AvatarSample A・B・C（VRoid、AvatarSample規約：商用可・クレジット不要・ヘイト等の用途は不可）

読み込み元は github.com/Cookieboty/companion-desk-models（タグで固定、配布元の照合値と一致を確認済み）と、github.com/madjin/vrm-samples、vrm-c/UniVRM、pixiv/three-vrm です。ToxSam/open-source-avatars のCC0カタログ（Arweave/IPFS）は、ブラウザから読み込めないものが多かったので削除しました。

## 4. PC版（`native/`）

`native/README.md` に、利用者向けの導入手順があります。

- `native/tracker/tracker.py`：OpenCVでカメラを読み、MediaPipeの3つのAIを LIVE_STREAM モード（非同期で並列）で動かして、UDP `127.0.0.1:39540` にJSONを送る
  - **送るデータ**：`pose`（33点×xyz）、`vis`、`hl`/`hr`（本人の左手/右手、21点×xyz）、`face`（目尻2・額・あご、計4点）、`bs`（表情8値）、`occ`（手が顔/口/目に重なっているか）
  - **確認済み**：mediapipe 1.2.2・Python 3.13 で、動画入力から40回分のデータが届くことを確認
- `native/unity/Assets/MirrorMocap/MirrorMocapReceiver.cs`：Animatorの人型の骨を、Web版と同じ考え方で動かす。表情は UniVRM 1.0 の `Vrm10Instance.Runtime.Expression.SetWeight` で入れる
  - Unity の座標は左手系（XYZの向きの取り方がWeb版と逆）なので、MediaPipe からの変換はミラー時 `(x,-y,-z)`、非ミラー時 `(-x,-y,-z)` にしている
  - **未確認**：Unityの代わりの簡易部品（スタブ）とのコンパイルが通ることだけ確認済み。実機のUnityでは一度も動かしていない。特に、骨の向き・左右・UniVRMのControl Rigとの干渉は要確認

### PC版の追加分（3回目）
- `native/bridge/bridge.py`：Web版から WebSocket（`ws://127.0.0.1:39541`）で受けて、VMC（`/VMC/Ext/Bone/Pos` など、ポート39539）と VRChat OSC（`/tracking/trackers/1〜8`・`head`、`/chatbox/input`、ポート9000）に送る。標準ライブラリだけ。**Origin を許可リストで確認**（公開Web版・localhost・file://）。受信テスト用プログラムで形式は確認済み、実アプリでは未確認
- Unity：表情キー 1〜5 / 0、Move Body（トラッカーが `sh`＝肩の中心と肩幅のピクセル値を送る）。スタブでのコンパイルのみ確認

## 5. 既知の課題・次にやること

### 2回目のセッション（2026-11-05）でやったこと
- **Unity版**：UniVRM 0.131.4 のソースを読んで確認した。エディタで取り込んだモデルには Control Rig が作られない（`Vrm10Instance.m_useControlRig` は保存されない設定で初期値 false）ので、骨の直接操作で正しい。実行中に読み込んで Control Rig があるモデルは、Control Rig の骨を動かすようにした
- **PC版の視線**：`vrm.Runtime.LookAt.SetYawPitchManually(yaw, pitch)` で対応（UniVRMでは +yaw＝モデルの右、+pitch＝上。`LookAtTargetType` は `YawPitchValue` にする）
- Unity 6 の新しい入力方式でも C / M キーが効くようにした。ポート使用中・Animator Controller 残りのときに Console に原因を出す
- **手が顔に重なる判定の不具合を修正**（Web版・トラッカー両方）：口・目との距離を、画像の縦横比を考えずに測っていたため、PCでは判定範囲が縦につぶれ（あごを触っても反応しにくい）、スマホでは縦に約1.8倍伸びていた。ピクセル基準に直した
- `native/README.md` に Unity の動作確認チェックリスト（11項目）を追加

### 3回目のセッション（2026-11-25）でやったこと
Web版に機能を大量追加（README の「できること」の表が一覧）。主なもの：背景・照明・配信モード・小窓（Document PiP）・スクショ・表情ボタン/独自表情/ピース・マイク口パク・自動まばたき・エフェクト・小物を掴む・アクセサリー・吹き出しと音声認識・体の位置・自分のVRMの保存（IndexedDB）・モーション記録/再生（VRMA・BVH）・PCブリッジ・パネルの折りたたみ・正面リセットのカウントダウン・設定の初期化。

後半に追加したもの：天気・カメラ追従・ポーズ固定（Space）・MP4録画・い/えの口・VMC受信（`bridge.py --vmc-in`、`applyVmcIn`）・体の当たり判定とリフティング（物理は1/120秒刻み）・魔法の杖・動画背景・紙吹雪と拍手・座りポーズと椅子・机・持ち替え・レーザーポインター・マウス目線・待機ゆらゆら・クリック反応・効果音（WebAudio合成）・透明スクショ・設定の保存/読込・起動用 .bat/.command・VRChatの表情パラメータとジャンプ・**OBS用ビューア**（`?viewer`。ブリッジが送る側の `frame` を viewer に中継する）。

コードの場所：`index.html` の「Extras」区画（`extrasBeforeUpdate` = 表情・再生・体の位置、`extrasAfterUpdate` = エフェクト・吹き出し・小物・ブリッジ送信・記録、`beforeRender`/`afterRender` = カメラ揺れ）。`window.__mocap` にテスト用の入口がある。

### 残り（どれも利用者の実機での確認が必要）
1. **PC版をUnity実機で動かす**：`native/README.md` の「5. 動作確認チェックリスト」（13項目）の結果をもらって直す
2. **外部連携を実アプリで確認**：VSeeFace / Warudo（VMC）と VRChat（OSCトラッカーはVRモードのみ有効、チャットボックス）。とくにVMCの骨の回転の向き（正規化ボーンのローカル回転を左手系に変換して送っている）
3. 手が顔に重なったときの対策の効き具合、「ぷるぷる」の好み、スマホでの重さ
4. 指差し（人差し指だけ伸ばす）・拍手の判定（両手の距離 9cm 未満・近づく速さ 0.8m/s 以上）と、小物を掴む判定（握り具合 `grip` のしきい値 0.6 / 0.35、届く距離 9cm）が実際の手で使いやすいか
5. アクセサリーの位置（レイで頭を測る方式。4体で確認済み。ほかのモデルでずれたら `measureHead` を調整）

### 開発環境で確かめられないこと
- 速さ（GPUがない）、実カメラでの手の握り（テストでは `grip` の値を直接与えた）、マイク（Chromeの偽デバイスのビープ音で反応だけ確認）、音声認識（確認ダイアログまで）

## 6. 開発のしかた（AIセッション向けメモ）

- このリポジトリの `index.html` がWeb版の本体です。編集して main に push すれば、1〜2分で GitHub Pages に反映されます
- **GitHub Pages の公開設定**などの「一般公開する操作」は、安全確認でAIからは実行できません。利用者に画面の操作をお願いしてください
- クラウド環境の制限
  - jsDelivr / unpkg / cdnjs / Arweave / opengameart.org / vroid.pixiv.help / hub.vroid.com には、AIの作業環境から接続できない
  - raw.githubusercontent.com・npm・PyPI・storage.googleapis.com（MediaPipeのモデル）には接続できる
- **Web版のテスト方法**（前回・今回のやり方）
  1. Playwright の Chromium に `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=写真.y4m` を付けて起動し、人物写真をカメラ映像の代わりにする
  2. CDN（jsDelivr）への通信は `page.route` で、npm で入れた three@0.170.0 / @pixiv/three-vrm@3.4.4 / @mediapipe/tasks-vision@0.10.21 のローカルファイルに差し替える
  3. この環境はGPUがないので、推定は1〜8fpsしか出ない。速さの評価はできない（動作確認だけ）
  4. 人物写真は `https://storage.googleapis.com/mediapipe-assets/pose.jpg`（全身）と `portrait.jpg`（上半身・正面）が使える
  5. 描画が1秒に3〜4コマしか出ないので、「数百ms後に結果を見る」テストは早すぎて失敗しやすい。結果が出るまで待つ形で書く（Playwright の `waitForFunction` に async 関数を渡すと Promise が真と判定されて待たないので注意）
  6. VRMA は `gltf-validator`（npm）で検証できる。three-vrm-animation@3.4.4 で読み戻して確認した
- **PC版トラッカーのテスト**：Linux では `libegl1 libgles2 libgl1` が必要です（`apt-get install`）。`python tracker.py --video test.mp4 --frames 40 --print` で、カメラなしでも試せます
- **Unityスクリプトのコンパイル確認**：mono-mcs と UnityEngine/UniVRM10 の簡易スタブで `mcs -langversion:Latest` を通しています（スタブはリポジトリには入っていません）

## 7. これまでの判断の経緯（要点）

- 推定と描画を分けて並列化したことで、描画は止まらなくなった
- 体のモデルは lite に下げたら精度が落ちたと言われたので、「標準」は full に戻した
- 「Webをやめるべきか」について：重さの大部分はAIの計算そのものなので、PCアプリにしても劇的には速くならない、と説明済み。それでも利用者はUnity版を希望したので、Web版を残したまま `native/` に追加した
