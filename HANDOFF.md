# Mirror Mocap 引き継ぎ資料

最終更新：2026-11-26（4回目のセッション：ファイル分割・表情・セキュリティ・設定欄の整理・テストの自動化）。次のセッション（人でもAIでも）が、ここから続きを始められるように書いています。

---

## 1. 何を作ったか

PC内蔵カメラ1台（フルトラッキングなし）で、体・顔（表情）・指の動きを推定して、3Dアバター（VRM）を動かすツールです。配信・小物・VRChat などとの外部連携の機能も、たくさん付いています。

| 部分 | 場所 | 状態 |
|---|---|---|
| **Web版**（本体） | `index.html`（1ファイル、約3700行）。**編集は `src/` で行い、`python3 tools/build.py` で組み立てる** | 開発環境で自動テスト済み。公開中 |
| **PCブリッジ** | `native/bridge/bridge.py` | Web版 ⇄ VMC / VRChat OSC の中継。受信テスト用プログラムで形式は確認済み。**実アプリでは未確認** |
| **PC版トラッカー** | `native/tracker/tracker.py` | Python ＋ MediaPipe。動画入力で送信まで確認済み |
| **PC版 Unity** | `native/unity/Assets/MirrorMocap/MirrorMocapReceiver.cs` | UniVRM 0.131 のソースと照合し、スタブでのコンパイルだけ確認。**Unity実機では一度も動かしていない** |
| 開発用の道具 | `tools/` | 自動テスト（`webtest/smoke.js`）、Unityのコンパイル確認、OSC受信テスト。説明は `tools/README.md` |

- リポジトリ：https://github.com/yanasota-creator/mirror-mocap
- 公開URL（GitHub Pages、スマホでも使用可）：https://yanasota-creator.github.io/mirror-mocap/
- OBS用ビューア：https://yanasota-creator.github.io/mirror-mocap/?viewer
- 利用者向けの説明：`README.md`（「できること」の表が機能一覧）、`native/README.md`（PC版・ブリッジ・外部連携・Unity のチェックリスト）

## 2. 利用者について

- 機械科の学生で、エンジニアではありません
- 説明は日本語で、専門用語には一言説明を付けてください
- コマンドを出すときは、先に目的を説明してください
- エラーのときは、まず原因から説明してください
- かわいいアニメ調の人型モデルが好みです（ちびキャラや動物は不採用でした）
- 「重い」「精度」を気にしています。PC版は Unity がいいという意向です
- **顔バレを気にしています**。カメラ映像の非表示とロックを付けました。音声認識のように外部に送る機能は、初期オフにして確認も出します
- 「機能を片っ端から増やしてほしい」という希望で、3回目のセッションで大量に追加しました
- 使っている端末：PC（Windows か Mac かは未確認）、スマホでも Web版を開いています

## 3. ファイルの構成

```
index.html                 Web版の本体（HTML・CSS・JS がすべて入っている）。src/ から自動で作るので直接編集しない
src/index.html             ページの骨組み。<!-- @include ファイル名 --> の行が、そのファイルの中身に置き換わる
src/style.css              見た目（CSS）
src/js/00〜99-*.js         スクリプトを元の順番のまま区切ったもの（下の「ファイル分割」）
README.md                  利用者向けの説明（できること・開き方・コツ）
HANDOFF.md                 この資料
native/README.md           PC版・ブリッジ・外部連携の説明、Unity の動作確認チェックリスト
native/tracker/            tracker.py, requirements.txt, start-windows.bat, start-mac.command
native/bridge/             bridge.py（標準ライブラリだけ）, start-windows.bat, start-mac.command
native/unity/Assets/MirrorMocap/MirrorMocapReceiver.cs
tools/                     開発用（build.py, test_all.py, test_bridge.py, webtest/smoke.js, unity-stubs/, osc_log.py）
.github/workflows/test.yml GitHub に送るたびに tools/test_all.py を自動で流す
```

### ファイル分割（4回目のセッション）
- `src/js/` の各ファイルは、もともと1つだった `<script type="module">` を**順番を変えずに区切っただけ**です。全ファイルが同じ1つのスクリプトとしてつながるので、変数はファイルをまたいでそのまま使えます（import / export は不要）
- 本格的な ES モジュールに分けなかった理由：(1) ファイルから直接開いたページ（file://）は別の JS ファイルを読めず、「index.html をダブルクリックで開く」使い方ができなくなる (2) 変数の共有が多く、書き換えが大きくて壊れやすい
- 分割した直後に組み立てた index.html が、元のファイルと1文字も違わないことを確認済み
- **ファイルの順番には意味があります**。`let` / `const` は宣言より前に読むとエラーになるので、新しいファイルを足すときは `src/index.html` の `@include` の行の位置に注意。新しい機能は `16-face-extras.js` のように、`99-boot.js` の前に足すのが安全です

| ファイル | 中身 |
|---|---|
| `00-setup.js` | ライブラリの読み込み、AIモデルのURL、配布モデルの一覧 |
| `01-ui-stage.js` | `$()`・`toast` など、three.js の舞台 |
| `02-avatar.js` | 骨の名前、マネキン、VRM の読み込み、`setAvatar` |
| `03-solver.js` | 関節の計算、One Euro、体・手・顔の推定結果→アバター（`solvePose` `solveHand` `solveFace`）、パーフェクトシンク、`idle` |
| `04-mediapipe.js` | AI（Web Worker）の起動 |
| `05-input.js` | カメラ・動画・VRMファイルの入力 |
| `06-loop-settings.js` | 毎コマの処理（`tick`）、録画、画質、設定の保存（`SAVED_IDS`） |
| `10`〜`15-*.js` | 追加機能（下の「5. 機能の地図」） |
| `16-face-extras.js` | 表情の固定・頬染め・うなずき・表情メーター |
| `17-panel-nav.js` | 設定欄のタブ（`data-cat`）と検索（`/` キー） |
| `99-boot.js` | 起動処理、テスト用の入口 `window.__mocap` |

## 4. Web版のしくみ（土台）

```
カメラ → Web Worker×3（体/顔/手のAIを並列） → 関節の角度を計算 → ばね式の補間 → three.js + three-vrm で描画
```

| 部分 | 中身 |
|---|---|
| ライブラリ | three@0.170.0、@pixiv/three-vrm@3.4.4、@pixiv/three-vrm-animation@3.4.4（VRMA再生時だけ動的 import）、@mediapipe/tasks-vision@0.10.21。すべて jsDelivr から読み込み、import map でバージョンを固定 |
| AI | 体 = Pose Landmarker（軽量=lite / 標準=full / 高精度=heavy）、顔 = Face Landmarker（表情52種）、手 = Hand Landmarker（2本） |
| 並列化 | AIごとに Web Worker。起動直後に GPU と CPU を実測して速い方を使う。Worker が使えなければメインスレッド（`createMainEngine`） |
| 軽量化 | 手首が映っていないときは手のAIを止め、8コマに1回だけ確認する。軽量モードは体と手を1コマおき。描画が35fpsを切ったら解像度を下げる。スマホは最初から軽量モード |
| 関節の計算 | `aim` / `basisQuat` / `worldFromBasis`。座標の変換は `conv`、ミラーの左右入れ替えは `subjSide` |
| 補間 | AIの結果を「目標の角度」（`targets`）にし、毎コマ、ばね＋ダンパー（減衰器）で近づける（`easeToTargets`）。`withTargets(fn)` の中では、骨の回転＝目標として書き換える |
| ブレ止め | One Euro フィルター |
| 手が顔に重なったとき | `faceOcclusion`（距離はピクセル基準。2回目のセッションで縦横比の不具合を直した） |
| 設定の保存 | localStorage の `mirror-mocap-settings`。保存する項目は `SAVED_IDS`（要素の id の一覧）。パネルの開閉は `mirror-mocap-closed`、★の視点は `mirror-mocap-myview` |

### 毎コマの処理の順番（`tick`）
1. `pump()`：AI に映像を渡す（ポーズ固定中は止める）
2. `withTargets(idle)` → `easeToTargets`：待機中の姿勢・呼吸・ゆらゆら → 補間
3. **`extrasBeforeUpdate`**：表情の合成（表情ボタン・ピース・マイク・自動まばたき・クリック反応）、モーション再生（`applyPlayback`）、体の位置と座りポーズ（`stepBodyPos`）、VMC受信（`applyVmcIn`）、OBSビューア（`applyViewer`）
4. `avatar.update(dt)`：three-vrm の更新（表情の反映・揺れもの）
5. **`extrasAfterUpdate`**：拍手・ジャンプの判定、カメラ追従、天気、杖、リフティング、紙吹雪、レーザー、GOOD!、エフェクト、吹き出し、手と小物（`updateHands`・`stepProps`）、ブリッジ送信（`bridgeFrame`）、モーション記録（`bvhCapture`）
6. `beforeRender` → 描画 → `afterRender`：カメラ揺れ（描画のあいだだけ位置をずらす）

追加機能の処理時間は、小物と雪を出した状態でも1コマ 0.2ms ほどです（パネルの「1回の推定」の後ろに「追加機能 ○ms」と出ます）。

## 5. 機能の地図（どこに何があるか）

`index.html` の後半の「Extras」区画（`/* ===== Extras ... */` から `/* ---------------- Boot` の前まで）に、追加機能がまとまっています。

| 分類 | 機能 | 主な関数・変数 | メモ |
|---|---|---|---|
| 配信 | 背景（3D部屋・グリーン等・画像・動画） | `applyBackground` `fitBackground` `buildRoom` `bgVideo` | 画像は "cover" で合わせる |
| | 照明 | `LIGHTS` `applyLight` | |
| | 配信モード（F / Esc） | `setStreamMode` | スマホはタップで終了ボタンが出る |
| | 小窓（Document PiP） | `pipWin` | キャンバスごと小窓へ移す。`resize()` より前に `let pipWin` を宣言（先に読むとエラーになるため） |
| | 天気 | `applyWeather` `stepWeather` | THREE.Points |
| | カメラ揺れ・追従・★視点 | `beforeRender` `followCamera` `MYVIEW_KEY` | ★の長押しの判定は、タイマーではなく操作の時刻で行う |
| | OBSビューア（`?viewer`） | `VIEWER` `setupViewer` `applyViewer` | ブリッジが送る側の `frame` を viewer に中継。viewer は設定を保存しない |
| 表情 | 表情ボタン・1〜5キー・独自表情 | `PRESETS` `presetW` `setPreset` `renderCustomExpr` | VRChatパラメータも `setPreset` から送る |
| | 無表情の記憶・感度 | `faceNeutral` `lastBlend`（`solveFace` 内の `g()`）、`#optMouthGain` `#optBlinkGain` | 正面リセット時に記憶 |
| | い・え の口 | `solveFace` の `target.ih` `target.ee` | |
| | マイク口パク | `mic` `micMouth` | |
| | ピース・グッド・指差し | `solveHand` の `grip.peaceAt` `grip[s+'GoodAt']` `grip[s+'PointAt']` | 指の伸び具合 `ext()` で判定 |
| | エフェクト | `fxTexture` `spawnFx` `stepFx` | 表情ボタン等で「自分で出したとき」だけ出す |
| | 自動まばたき・マウス目線・クリック反応 | `autoBlink` `mouseGazeTarget` `reaction` | |
| | 喜怒哀驚（眉と目から） | `solveFace` の `MOOD`、`#optEmotion` `#optEmotionGain` | 笑うと目が細くなり、AIが「眉が下がった」とも判定するので、怒りは eyeSquint を引き、笑顔で打ち消す（笑顔の写真で確認） |
| | ウインク | `solveFace` の `wink` | 片目だけはっきり閉じたときは、両目の連動を外す |
| | パーフェクトシンク | `ARKIT` `perfectSyncMap` `showPerfectSyncStatus` | モデル独自の表情に ARKit 52種の名前が20個以上あれば対応とみなす（大文字小文字は無視）。オンのときは基本の口・まばたき・喜怒哀驚を0にする（二重に変形するため）。目線は今まで通り骨で動かす。52種は独自表情ボタンから除く |
| | 表情の固定（H） | `exprLocked` `setExprLock` | カメラからの表情（`exprState`）だけ止める。表情ボタンは使える |
| | 頬染め（B） | `blush` `buildBlush` `blushTarget` | 頭の大きさ基準で置き、頬の表面を5点測った中央値の少し手前。測定はその場で行う（頭は動くので、前に測った値を使うとずれた） |
| | うなずき・首振り | `nod` `swings` `stepNod` | `lastRaw.head`（カメラから見た頭の向き）の上下・左右が、1.6秒以内に2回以上切り返したら。初期オフ |
| | 表情メーター | `stepMeter` | パーフェクトシンク中は52種のうち強い12個を出す |
| 動き | 体の位置（左右・前後・上下） | `bodyPos` `stepBodyPos` | 肩の中心と肩幅のピクセル値から。前後は「肩幅の見かけ」 |
| | 肩をすくめる | `shrug`（`solvePose` 内） | 耳と肩の縦の距離 ÷ 肩幅 |
| | 座りポーズ・椅子・机 | `sit` `isSitting` `legRest` `placeChair` `placeDesk` `desk.box` | 脚が1秒映らないと座る |
| | ポーズ固定（Space） | `frozen` `setFrozen` | |
| 小物 | 出す・掴む・離す・持ち替え | `makeProp` `spawnProp` `updateHands` `holdUpright` | 握り具合 `grip[s]`（0〜1）、しきい値 0.6 / 0.35、届く距離 9cm |
| | 物理・当たり判定 | `stepProps` → `stepPropsOnce`（1/120秒刻み）、`bodyColliders` | 刻まないと速いボールが頭をすり抜ける |
| | マウスでドラッグ | `drag` | 投げる速さは操作の時刻（`e.timeStamp`）から |
| | リフティング・杖・紙吹雪・拍手・レーザー・GOOD! | `lift` `stepWands` `burstConfetti` `detectClap` `stepLasers` `stepGood` | |
| アクセサリー | ねこ耳・王冠・メガネ・天使の輪 | `headFrame` `measureHead` `applyAccessories` | 頭の座標系でレイを撃って、頭頂・顔の表面を測る |
| 吹き出し | 吹き出し・音声認識 | `showBubble` `stepBubble` `say` `startSpeech` | 音声認識は Google に送られるので初期オフ＋確認 |
| 保存 | 録画（MP4優先・声とBGM）・スクショ（透明も可） | `startRecording` `recordingAudio` `bgm` `#shotBtn` | |
| | モーション記録・再生 | `exportPose` `bvhText` `vrmaBinary` `parseBVH` `playVRMA` `applyPlayback` | VRMA は GLB を手書き（公式バリデータでエラー0） |
| | 自分のVRMの保存 | `idb` `saveOwnVRM` `ownList` `loadOwn` `renderOwn` | IndexedDB `mirror-mocap` / `vrms` |
| | 設定の保存・読込・初期化 | `#exportSettings` `#importSettings` `#resetSettings` | 読み込みは `SAVED_IDS` の項目だけを受け付ける |
| 外部連携 | ブリッジ接続・送信 | `bridge` `connectBridge` `bridgeFrame` `bridgeSend` | `ws://127.0.0.1:39541` |
| | VMC受信 | `vmcIn` `applyVmcIn` `vrmBoneName` `vmcExpressions` | |
| | VRChat：表情パラメータ・ジャンプ・チャット | `setPreset`、`detectJump`、`say` | |
| その他 | 効果音 | `sfx` | WebAudio で合成（音声ファイルなし） |
| | テスト用の入口 | `window.__mocap` | テストから値を直接読んだり、与えたりする |

## 6. 通信のまとめ

| 経路 | 方式・ポート | 中身 |
|---|---|---|
| Web版 → bridge.py | WebSocket `ws://127.0.0.1:39541` | `{type:'frame', bones, pos, trackers, blend, model}`（約30回/秒）、`chat` `typing` `param` `jump`、OBSビューアは `{type:'hello', role:'viewer'}` |
| bridge.py → VMC受信アプリ | UDP 39539 | `/VMC/Ext/Bone/Pos`（Unityの骨名、左手系）、`/VMC/Ext/Blend/Val`（VRM0の名前 A, Joy など）→ `/VMC/Ext/Blend/Apply` |
| bridge.py → VRChat | UDP 9000 | `/tracking/trackers/1〜8/position・rotation`、`head`、`/chatbox/input`、`/avatar/parameters/<名前>`、`/input/Jump` |
| VMC送信アプリ → bridge.py → Web版 | UDP 39542（`--vmc-in-lan` で LAN からも）→ WebSocket | `{type:'vmc', bones, blend}` |
| bridge.py → OBSビューア | WebSocket | 送る側の `frame` をそのまま中継 |
| tracker.py → Unity | UDP 39540 | `pose` `vis` `hl` `hr` `face` `bs` `occ` `sh`（肩の中心と肩幅のピクセル値） |

- bridge.py は **Origin（接続元のページ）を許可リストで確認**します（公開Web版・localhost・127.0.0.1）。ほかのサイトからは 403 で拒否
- **file:// のページ（Origin が `null`）は接続コードが必要**（4回目で変更）。`null` は、どのサイトでも sandbox 付きの iframe で作れるので、以前は他のサイトから VRChat のチャット書き込みや姿勢の盗み見ができた。コードは `native/bridge/bridge-code.txt`（git には入れない）。5回間違えると1分止める
- bridge.py の守り：1メッセージ1MB まで（分割されたものも合計で）、マスクのないフレームは切断、同時接続8まで、壊れた JSON や型違いは捨てて接続は続ける、チャットの制御文字は除く、VMC受信は骨64・表情128個まで・NaN は捨てる・バンドルの入れ子は4段まで
- Web版の守り：CSP（`src/index.html` の meta。インラインスクリプトのハッシュは build.py が自動で入れる）、インポートマップの `integrity`（ライブラリ6ファイルと、MediaPipe の5ファイル＝本体と WebAssembly。MediaPipe は Worker の中で読むので import map は効かず、`mpLoad` が `fetch(url, { integrity })` で取ってから blob URL にして使う。そのため CSP の script-src に `blob:` がある。バージョンを上げるときは `tools/webtest/node_modules` の同じファイルから sha384 を計算し直す。違うとページが起動せず「読み込めませんでした」の案内が出る）、ブリッジから届く数値は `cleanBones` `cleanBlend` で NaN や変な名前を捨てる
- **CSP に通信先を足すとき**：新しい外部のサーバーを使う機能を作ったら、meta の `connect-src` や `img-src` に足さないとブラウザに止められる（自動テストの「ページのエラーがない」で気づける）
- 外へ出す骨の値（`exportPose`）は、正規化ボーン（T字ポーズで回転0の骨）のローカル回転です。**VRM 0.x は three-vrm の中で180°回されているので、送るときに (−x, y, −z, w) で戻します**。受け取るとき（VMC受信・ビューア・VRMA）も同じ考え方です
- three.js → Unity の変換：位置 (−x, y, z)、回転 (x, −y, −z, w)

## 7. 確認できていること・いないこと

### 開発環境で確認済み
- `tools/webtest/smoke.js` の17項目（VRM読み込み、背景、表情キー、小物を掴む／離す、スクショ、VRMA の記録→再生、吹き出し、座りポーズ、眉と目から怒り・驚き、ウインク、表情の固定、頬染め、うなずき・首振り、表情メーター、パーフェクトシンク、カメラ映像（写真）からの推定、エラーなし）。表情は `__mocap.testFace(表情の数値, 上下の角度, 左右の角度)` で、AIの結果の代わりに数値を与えている
- パーフェクトシンクは対応モデルが手元にないので、テスト中に読み込んだモデルへ52種の空の表情を登録して確かめた
- 頬染めの位置は配布モデル1体で正面・横から目で確認（ほかのモデルでずれたら `buildBlush` の係数を調整）
- 個別のテスト（このセッションで実施）：VRM 0.x と 1.0 の間で、骨の値が一致することの往復確認。ブリッジ経由の VMC・VRChat・VMC受信・OBSビューアのデータ。MP4 録画（声・BGM入り）。透明スクショ。自分のVRMの保存と復元。IndexedDB。小窓。iPhone 幅のレイアウト（横のはみ出しなし）
- 追加機能の処理時間：1コマ約0.2ms

### 開発環境では確かめられないこと（利用者の実機で確認が必要）
優先度の高い順です。
1. **Unity実機**：`native/README.md` の「5. 動作確認チェックリスト」（13項目）。とくに骨の向き・左右
2. **外部アプリ**：VSeeFace / Warudo（VMC。骨の回転の向き）、VRChat（トラッカーは VR モードのみ、チャットボックス、表情パラメータ、ジャンプ）、mocopi・iPhone アプリからの VMC 受信、**OBS のブラウザソース**（透過表示）
3. **実際の手の動き**：掴む・離す・持ち替え、拍手、ピース、グッド、指差し、リフティング（テストでは握り具合などの値を直接与えた）
4. **Windows の起動ファイル**（.bat）。Mac 用は、この環境で起動まで確認済み
5. 速さ（GPU のある PC・スマホ）、マイク口パク（偽デバイスのビープ音で反応だけ確認）、音声認識（確認ダイアログまで）
6. **表情の再現（4回目で追加）**：実際の顔で、怒り・悲しみ・驚きが自然に出るか、考えごとをしているだけで怒り顔にならないか（感度の初期値の調整が必要かもしれない）。パーフェクトシンク対応モデルでの見た目。うなずきの判定の効き具合
7. アクセサリーの位置（4体で確認済み。ずれるモデルがあれば `measureHead` を調整）、表情の感度・無表情の記憶の効き具合

## 8. 開発のしかた（AIセッション向けメモ）

- **`src/` を編集 → `python3 tools/build.py` → `index.html` と `src/` を両方 commit** → main に push すれば、1〜2分で GitHub Pages に反映されます。`index.html` を直接直すと、次の組み立てで消えます。`python3 tools/build.py --check` で組み立て忘れがないか確かめられます
- **GitHub Pages の公開設定**などの「一般公開する操作」は、安全確認で AI からは実行できません。利用者に画面の操作をお願いしてください
- push が「credential service temporarily unavailable（503）」で失敗することがありました。作業環境側の一時的な障害で、しばらく後の再送で通りました
- クラウド環境の制限
  - jsDelivr / unpkg / cdnjs / Arweave / hub.vroid.com などには接続できない
  - raw.githubusercontent.com・npm・PyPI・storage.googleapis.com（MediaPipe のモデルとテスト用写真）には接続できる。公開リポジトリ（例：vrm-c/UniVRM）は clone できる
- **テスト**：`python3 tools/test_all.py` で全部（組み立て・SRI・文法・ESLint・ブリッジ・ブラウザ。`--a11y` で axe も）。GitHub では全部＋本物の jsDelivr との指紋照合が毎回走る。ブラウザのテストの共通部分は `tools/webtest/lib.js`。詳しくは `tools/README.md`。smoke.js はWebサーバーを自分で立てるので、別のターミナルは不要
- **設定欄**：区分（`<section class="sec">`）には `data-cat` で分類（basic / face / stream / play / save / link、複数可）を付ける。付け忘れるとタブで出なくなる。検索は区分の中の直下の要素ごとに文字を探す
- **グリッドのはみ出し**：グリッドの列は `minmax(0, 1fr)` にする（`1fr` だけだと、横に長い部品1つで欄全体がはみ出した）
  - 描画は1秒に3〜5コマしか出ません。決まった時間だけ待つテストは失敗しやすいので、結果が出るまで待つ形で書きます
  - Playwright の `waitForFunction` に async 関数を渡すと、Promise が「真」と判定されて待ちません
  - 折りたたまれている欄の中の要素はクリックできません。テストでは `.sec.closed` を外してから操作します
  - チェックボックスをクリックした直後は、キー入力が入力欄に向いていて、ページのキー操作が無視されます。先に3D画面をクリックします
- **PC版トラッカーのテスト**：Linux では `libegl1 libgles2 libgl1` が必要です。`python tracker.py --video test.mp4 --frames 40 --print` で、カメラなしでも試せます
- **Unity のコンパイル確認**：`tools/unity-stubs/check.sh`。UniVRM の API を新しく使うときは、`Stubs.cs` にも足します（UniVRM の実際のソースで名前を確かめること）

### つまずいた点（同じ失敗をしないために）
- **three.js の AnimationMixer は、値が前のコマから変わったときしか書き込まない**。そのため、動かない骨や一定の表情が、追跡の処理に上書きされた。VRMA の再生では、トラックを毎コマ自分で評価して書き込む方式にした
- **`let` / `const` は、宣言より前に読むとエラーになり、`typeof` で確かめても同じ**。起動時に呼ばれる関数（`resize` など）が使う変数は、前のほうで宣言する
- **重い環境では、タイマーや「処理した時刻」が遅れる**。長押しやドラッグの速さは、操作の時刻（`e.timeStamp`）で判定する
- `$()` は id で探した要素を覚えておく（毎コマ何十回も呼ぶため）。id の要素は作り直さない前提
- 小物の物理は、1/120秒刻みで計算しないとすり抜ける
- エフェクトや吹き出しの位置は、頭の骨からの固定の距離ではなく、`measureHead` で測った値を使う（頭の骨は首の付け根あたりにあり、頭の大きさもモデルごとに違う）
- VRoid の目の骨は見た目の目より内側にあるので、目の骨の間隔はメガネの大きさにだけ使う

## 9. これまでの判断の経緯（要点）

- 推定と描画を分けて並列化したことで、描画は止まらなくなった
- 体のモデルは lite に下げたら精度が落ちたと言われたので、「標準」は full に戻した
- 「Web をやめるべきか」について：重さの大部分は AI の計算そのものなので、PC アプリにしても劇的には速くならない、と説明済み。それでも利用者は Unity 版を希望したので、Web版を残したまま `native/` に追加した
- ブラウザは UDP（VRChat などが使う通信）を送れないので、外部連携は Python の中継プログラム（bridge.py）を挟む形にした。追加のインストールが要らないよう、標準ライブラリだけで書いた
- 小物の掴み判定は「握った瞬間」だけにした（握りっぱなしの手を近づけただけで、勝手に掴まないように）
- エフェクトは、カメラが笑顔を見たときではなく、表情ボタンやピースのときだけ出すようにした（自然に笑うたびにハートが出るとうるさいため）

## 10. 次にやるとよいこと（案）

- 利用者の実機確認（上の7の順番）の結果をもらって直すのが最優先
- Unity 版に、Web版の配信機能（背景・表情ボタンなど）をどこまで移すか、利用者と相談する
- 表情の感度（喜怒哀驚のしきい値）を、利用者の実際の顔に合わせて調整する
- VRChat の顔トラッキング用パラメータ（VRCFaceTracking 形式）に、表情52種を送る。パラメータ名の仕様の確認が必要
