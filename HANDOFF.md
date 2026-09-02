# SketchAlive — 引き継ぎ (更新: 実写対応 + ライブAR + PWA + 会話機能 + Streamlit埋め込み)

依存ゼロ・ビルド不要のブラウザ完結プロトタイプ。Phase 1（実写対応）〜Phase 4（SNS投稿）
＋PWA化＋WebLLM会話機能＋Streamlit埋め込みまで実装したが、**実機（実際のスマホ・
実際の紙）では未検証**。以下は正直な現状リスト。

## セリフの書き直し + 声のバリエーション (2026-08-31)

**セリフ**: `LINES.ja`/`LINES.en`が皮肉・毒舌寄りだった（「作者を訴えたい。」「自然は
過ちを犯した。」等）。ユーザーから「可愛くない」「変なのやめろ」と明確な指摘があり、
spawn/tap/drop/dance/各特徴（noArms/noLegs/largeHead/shortLegs/lowConf/ugly）/
returningの全カテゴリを可愛い・温かいトーンに全面的に書き直した。日本語は読み上げ
(`speechSynthesis`)前提で、「…」「―」のような読み上げで不自然な間が出やすい記号を排除し、
だよ/だね/んだ等の自然な話し言葉の語尾に統一している。

**声のバリエーション**: これまで`say()`は全キャラクター共通で`pitch:1.3, rate:1.05`
固定だった。`VOICE_PROFILES`（genki/gentle/sleepy/quirky/shyの5種、それぞれpitch・
rateが異なる）を追加し、`Character`生成時に`result.traits`（足が短い→genki、頭が
大きい→gentle、足がない→sleepy、腕がない→shy、認識不能→quirky、該当なしはランダム）
に応じて1体につき1つ割り当てる(`pickVoiceProfile()`)。その声はキャラクターの生存期間中
ずっと保持され、`say()`はそのつど`app.char.voice`から読む。端末に複数の日本語/英語音声
(`speechSynthesis.getVoices()`)がある場合は、それも1体につき1つランダムに割り当てる
(`pickSynthVoice()`) — ただし多くのモバイルブラウザは言語ごとに1声しか無いため、
これはボーナス扱いで、主な差別化はpitch/rateの方。

## 可動のブレンド + 滞在時間対策 (2026-08-31)

**ポーズ間ブレンド**: 各アクション(`POSES`内の`idle`/`wave`/`dance`等)は`ch.action`が
切り替わった瞬間、常に`t=0`の関節角度から描き直されていた——直前のポーズの角度とは
一致しないため、タップ→ダンス、着地→idle等の切り替えで視覚的な「ポップ」が毎回起きて
いた。`render()`に150ms(`POSE_BLEND_SEC`)のイージング付きブレンド
(`lerpPose`/`easeOutCubic`)を追加し、実際に描画されていたポーズから新しいポーズへ
なめらかに遷移するようにした。依存追加なし、全アクションに自動適用（呼び出し側の
`ch.action=`の書き換えは一切不要）。既存のidle呼吸モーション(`Math.sin`ベースの微振動)
はそのまま活かしている。

**滞在時間**: 二つの軽い仕掛けを追加。
1. ダンスが発火した瞬間(ダブルタップ／ランダムタップ／会話のアクションタグ経由の
   いずれでも)、録画中でなければ既存の`#hint`表示枠を一時的に「今の、録っておく？」に
   差し替えて3.2秒表示 (`maybeSuggestRecording()`)。30秒間はクールダウンして連呼しない。
2. `localStorage`の`sa_spawn_count`で「このデバイスで何体目か」を数え、2体目以降は
   スポーン時のセリフとして60%の確率で`LINES.*.returning`（「また来てくれたんだね」系）
   を使う。**同じキャラクターが戻ってくるわけではない**（毎回新しい絵から生成される）が、
   「同じ絵描きの端末である」ことは実際に観測できる事実なので、そこにだけ乗せている。

**トイストーリーのIPについて**: ユーザーから「トイストーリーを限りなくパクって欲しい」
という要望があったが、固有名詞・台詞・商標を使う形での実装は見送っている（著作権/商標
侵害リスクがあり、かつ既に一般公開済みのリポジトリ・Streamlit URLに乗るため）。代わりに
「持ち主が見ていない時だけ動く」「作者への忠誠」「戻ってきてくれて嬉しい」といった、
その作品より古くから存在する一般的なトロープの範囲内でトーンを強化する方向で対応した。

## 会話機能 (WebLLM, `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`)

💬ボタンでチャットパネルを開き、テキストまたは音声(Web Speech API、Chromeではクラウド
送信される点に注意)で話しかけると、ブラウザ内WebGPU推論(`@mlc-ai/web-llm`をCDN経由で
動的import)でキャラクターが人格プロンプト付きで応答する。返答の末尾に
`[idle]/[wave]/[dance]/[jump]/[panic]`のいずれかを付けさせ、`extractActionTag()`で
パースしてキャラの実際の動きに反映する（表示・音声には出さない）。脱走演出タイムライン中
は上書きしない。返答は1文限定・`max_tokens:45`に絞ってあり（旧: 1〜2文/80）、テンポ
重視で短くしている(2026-09-02)。ユーザーが何かを見せて教える流れ（「これはロボットの
おもちゃだよ」等）に興味を持って反応するよう、人格プロンプトに専用の一文も追加した。

人格プロンプトは「紙から今しがた密かに命を得た、描いた人に忠実な存在」という温かみ寄りの
トーンにしてある。子供向けの優しさを強めるため、「密かに命を持った玩具が、作った子供に
話しかけるような、優しく安心させる話し方」という指示も追加してある。**特定の作品
（トイストーリー等）のキャラクター名・台詞・商標は一切使っていない**——「誰も見ていない
時だけ動く」「描いた人への忠誠」はその作品以前からある古典的トロープであり、著作物その
ものではなく着想レベルの参照にとどめてある。

### モデルサイズ: 1.5B→0.5Bに戻した実機クラッシュ対応 (2026-08-30時点)

最初は`Qwen2.5-1.5B-Instruct-q4f16_1-MLC`を使っていた（0.5Bは日本語指示を無視して中国語
混じりで返答し、アクションタグもほぼ出さなかったため）。1.5Bはこのマシン上のChromeでは
複数回問題なく動いたが、**実機（ユーザーのスマホ）でチャット機能を使おうとした時に
タブがクラッシュする報告が複数回あった**。GB級の重みをWebGPU用バッファに載せる時点での
OOM killである可能性が高く、こちら側のtry/catchでは防げない種類の失敗。クラッシュは
「日本語以外が混ざる」より明確に悪い結果なので、`CHAT_MODEL_ID`を0.5Bに戻した
(`index.html`)。指示追従の弱さは既知のトレードオフとして許容している。

### 自動ロードを一切やめた後、「スキャン開始」トリガーに戻すまでの経緯

1. **最初の設計**: ページ読み込み時に自動でモデルをダウンロード開始。
2. **実機クラッシュ報告を受けて全面撤去**: 自動ロードを完全に削除し、チャットパネルを
   開いても`#chatStartWrap`（サイズ・不安定性の警告付き）が出るだけにし、
   `#chatStartBtn`を明示的にタップしない限り絶対にダウンロードが始まらないようにした。
   `sendChatMessage()`側にも`!chat.engine`なら問答無用でゲート画面に戻す安全弁を追加
   （UIをバイパスした直接呼び出しでも発火することをテストで確認済み）。
3. **クラッシュ検知用のbreadcrumb追加**: ロード開始時に`localStorage`へ
   `sa_chat_load_started`をセットし、成功/失敗いずれでも`finally`で消す。次回起動時に
   このキーが残っていれば「前回ロード中に異常終了した形跡」として`#crashNotice`バナーを
   出す（ワンショットで自己消去）。この仕組み自体は現在も生きている。
4. **ユーザーが明示ゲートでの成功を報告**（「download and start chattingが出てきました」）
   → 事前ロードの要望が再度出たため、一度「成功した端末だけ次回から自動プリロード」という
   `sa_chat_load_ok_before`フラグ方式を実装したが、ユーザーから
   「スキャン始めた時から自動でやっておいたらいい」という指示を受けて**この方式は撤回**。
5. **現在の方式**: ページ読み込み時の自動ロードはしない（未知の訪問者に対してはクラッシュ
   時と同じ理由でまだ避けたい）が、`#scanBtn`・`#arBtn`・練習用プリセットボタンの
   いずれかをタップした瞬間——つまり「本当にこのアプリを使う意思表示があった瞬間」——に
   `preloadChatModel()`が発火し、バックグラウンドでモデルの取得を開始する
   (`index.html`)。絵を描いたり紙を探したりスキャンする数秒〜数十秒の間にロードが進むため、
   会話ボタンを押す頃には準備できている可能性が高い。`chat.engine`or`chat.loading`が
   真ならスキップ（多重ダウンロード防止）、Data Saver有効時はスキップ。breadcrumb・
   `#crashNotice`の安全弁はそのまま生きている。

## Streamlit埋め込み (`streamlit_app.py`)

`index.html`/`core.js`を無改造のまま`st.components.v1.html()`に埋め込むだけ。
Streamlitのコンポーネント用iframeはデフォルトで`allow="camera; microphone; ..."`を
含むため、スキャン・ライブAR・音声入力チャットまで含めてそのまま動くことを実際に
起動して確認済み。**GitHub(YUHI-AI-Labs/sketchalive)経由でStreamlit Community Cloudに
実際にデプロイし、公開URLで動作確認済み**（https://sketchalive-pcn8hc4ce459dyex8u5lwr.streamlit.app/ ）。

公開直後、Streamlit標準のヘッダー/ツールバー/フッターが縦スペースを食い、スマホ幅だと
下部のボタン（スキャン・SET IT FREE等）がスクロールしないと見えない不具合が実際に
報告された→CSSでStreamlitのデフォルトchromeを非表示にし、iframeの高さを調整して解消。

## PWAキャッシュの注意 (`sw.js`)

**初版は同一オリジンの全リクエストをcache-firstにしていたため、一度訪問したユーザーは
`index.html`が更新されても古いバージョンを見続ける不具合があった**（実際に「新しく
追加した💬ボタンが出てこない」という形で発生を確認）。`index.html`/`core.js`/`/`は
network-first（オフライン時のみキャッシュにフォールバック）に変更し、`CACHE_VERSION`を
`v2`に上げて解消。アイコン等の静的アセットのみcache-firstのまま。**今後index.html/core.js
を更新するたびに`CACHE_VERSION`を上げる必要はない**（network-firstになったため）が、
静的アセット(icons/manifest)を変える場合はまだ上げること。

## 足が描かれていない場合 (2026-08-30 修正)

旧ヒューリスティックは「bbox下部28%にあるインクの左右端」を機械的に足とみなしていたため、
足を一切描かない場合に**胴体の下端そのものを両足として誤検出**（左右がほぼ同じ点に重なる
不自然な立ち姿）したり、**腕の先端を足と誤検出**したりする実バグがあった
（`node -e`での直接検証で再現・確認済み）。`estimateJoints`に、候補点が既に検出済みの
手の位置に近い場合と、左右候補が両方とも胴体の中心線付近に落ちる場合を除外するガードを
追加して解消。`test-fixtures.mjs`に恒久的な回帰テストを追加済み。腕が垂れて足の代わりに
誤検出されるケース（境界事例）は完全には解消していないが、クラッシュはせず、見た目上
壊滅的に破綻することもない（ヒューリスティックの限界として許容）。

## 動かし方

```bash
cd sketchalive
python3 -m http.server 8000   # または npx serve
# → http://localhost:8000 （スマホは同一LANのIPで開く。カメラはHTTPSかlocalhostのみ）
node test-core.mjs      # コアパイプライン golden path（合成棒人間、seed固定）
node test-fk.mjs        # FK / スキニング行列の数値検証
node test-paper.mjs     # 紙四隅ホモグラフィ + 紙検出ヒューリスティック
node test-fixtures.mjs  # 実写を模した合成フィクスチャ9種（下記「正直な注記」参照）
```

## 今回追加したもの

### Phase 1: 実写対応
- **複数連結成分の統合** (`core.js: assembleCreature`) — 従来は最大連結成分だけを採用
  していたため、頭と胴体が数px離れているだけで頭が消える不具合があった。今は最大成分を
  胴体アンカーとし、距離・サイズでフィルタしながら近傍成分を統合する。デバッグパネルの
  「components」タブで採用(緑)/除外(赤,理由付き)を可視化できる。
- **デバッグモード** (`index.html`: FOUND画面下部「🐛 Debug」) — 二値化マスク・採用/除外
  コンポーネント・15関節・紙検出結果の4タブ切り替え。
- **紙の四隅検出+台形補正+手動調整** — `core.detectPaperQuad`（低彩度・高輝度の最大連結
  成分＋4方向支持関数で四隅近似）→ `core.warpQuadToRect`（Heckbert型
  square-to-quad射影ホモグラフィ、`test-paper.mjs`で数値的に検証済み）→ 常に
  「これでスキャン／紙全体を使う／撮り直す」の確認・調整UI（`#corners`画面）を経由する。
  自動検出に失敗しても手動タップ調整 or 全体使用にフォールバックできる。

### Phase 2: ライブカメラAR（一次実装、実験的）
- `getUserMedia`背面カメラのライブ表示＋透明Canvas重ね描き。
- スキャン時に台形補正→キャラクター抽出は静止画パスと共通コード。
- スキャン後は10〜15fps相当（90ms間隔）で紙を再検出し、四隅をEMA平滑化。ホモグラフィで
  キャラクターのアンカー点・回転・スケールを紙に追従させる（**近似は affine/射影位置追従
  であり、真の3D姿勢推定ではない**）。confidence不足時はキャラクターを描かず
  「紙をもう一度映してください」を表示。
- 紙から脱走した後は既存の物理（重力・床衝突）にそのまま委譲し、紙追従は止まる（仕様の
  「疑似机面を歩かせてよい」を素直に解釈）。

### Phase 3: 認識失敗を面白さに変える
- `not_humanoid`トレイト（統合後の連結成分数>5）を追加し、`ugly`台詞（「自然は過ちを
  犯した」/"Nature has made a mistake."）をFOUND画面・脱走時セリフの両方に配線。
- 白紙・紙未検出は引き続き明示的に撮り直しを要求（`ok:false`→retake導線）。

### Phase 4: SNS投稿
- **録画に音声を追加**: speechSynthesisの出力はどのブラウザでもMediaStreamへキャプチャ
  できないため、録画中だけ別途Web Audio（`AudioContext.createMediaStreamDestination`）で
  「トーク音」を合成し、canvasの映像トラックとミックスして`MediaRecorder`に渡す。ライブ
  再生（非録画時）は従来どおりspeechSynthesisのみで変更なし。
- `MediaRecorder.isTypeSupported("video/mp4")`を優先し、非対応環境はWebMへフォールバック。
  ただし**bareな`"video/mp4"`だけのチェックは信用しない**こと — 検証環境のChromeで
  bareチェックがtrueを返しつつ実際はVP9/Opusを非標準の.mp4コンテナに詰めていたケースを
  確認したため、`video/mp4;codecs="avc1...,mp4a..."`のような明示的なH.264コーデック文字列
  でのチェックを先に試す実装にしてある（`pickRecordingMime()`）。

#### 発見・修正した重大バグ: 無音キャラクターの録画が数百ms〜数秒で止まる
録画（●10s）が、`say()`が一度も呼ばれない区間（例:何も喋らずアイドルのまま）だと
数百ms〜3秒程度でエンコードが実質停止し、`MediaRecorder`は`stop`イベントを10秒後に
正しく発火するのに、実際にエンコードされている中身は最初の一瞬だけという不具合があった。
`ondataavailable`は無エラー、映像トラックの`ended`/`muted`も発火せず、`captureStream`の
fps・timeslice指定・bitrate指定・ヘッドレス有無を変えても再現し続けた。

原因を1件ずつ切り分けた結果、**`AudioContext.createMediaStreamDestination()`で作った
オーディオトラックに、`AudioNode`が一つも接続されていない（完全に無音・無接続）状態だと
`MediaRecorder`が映像トラックも含めて丸ごとバックプレッシャーで止まる**ことを直接検証で
確認した（同一条件で、無音でもいいので何かひとつオシレーターを繋いでおくだけで8秒の
録画が正常に完走することを確認）。`ensureAudioCtx()`で録音先を作る際、**gain=0の
「常時接続だけしておくオシレーター」を作成時点から繋ぎっぱなしにする**ことで解消した
（`say()`が一度も呼ばれなくても音声グラフが「生きている」状態を保つ）。

修正後、実機（このChromeビルド）で idle 10秒録画・脱走シーン込み10秒録画とも
フルデュレーション・実音声入りで完走することを確認済み。ただし他ブラウザ
（Safari/Firefox）でも同じ回避策が必要かは未確認。
- Object URLは共有不可時のダウンロードリンク発行後に`revokeObjectURL`する。

### App-readiness pass: PWA化 + もう1件のバグ修正

- **PWA化**: `manifest.json`（standalone表示・アイコン3種・maskable対応）＋
  `sw.js`（app-shellをcache-firstでキャッシュし、初回訪問後は完全オフラインで動作。
  Google Fontsはstale-while-revalidate、失敗時はCSSのフォールバックフォントスタックに
  自然に落ちる）を追加。`icons/`はアプリ自身の手描き風スタイル（赤ペン・逃げる棒人間）で
  生成。Playwrightで実際にネットワークを切って「リロード→プリセット→脱走まで完走」を
  確認済み（見出し・ダミーではなく実オフライン動作）。
- **発見・修正したバグ: カメラストリームのリーク** — `startAR()`は、既に`ar.stream`が
  開いている状態（四隅確認画面からの「撮り直す」、または認識失敗後の「撮り直す」で
  AR中に再度呼ばれるケース）でも、古いストリームを止めずに新しい`getUserMedia`を
  リクエストしていた。撮り直しを繰り返すたびにカメラストリームが積み上がり、
  カメラ使用中インジケータが点灯しっぱなしになる・バッテリーを消費する・最終的には
  OS側の同時ストリーム数制限で`NotReadableError`になりうる不具合。`startAR()`冒頭で
  既存の`ar.stream`のトラックを`stop()`してから新規リクエストするよう修正し、
  「2回連続でstartAR()を呼んでも1個目のストリームは`ended`、2個目だけ`live`」を
  実際に検証済み。

### 品質修正
- `test-core.mjs`の`Math.random()`をseed固定の`core.mulberry32`に置換（決定的テスト）。
- ファイル読み込みを`createImageBitmap(file,{imageOrientation:'from-image'})`に変更し
  EXIF回転を自動補正（フォールバックあり）。画像デコード失敗・非画像ファイルはエラー
  画面（撮り直し導線）へ。
- `processImage()`に多重起動ガード（`processing`フラグ）を追加し、抽出処理中の連打を防止。
- カメラ権限拒否時に専用画面(`#camDenied`)で写真パスへの導線を提示。
- `LICENSE`(MIT) / `PRIVACY.md`を追加。

## 正直な注記（実機で崩れる可能性が高い順）

1. **実写真では依然として未検証**。今回の「実写対応」は全て合成フィクスチャ
   （影・罫線・斜め撮影・頭部分離・カラーペン・木目背景・複数落書き・非棒人間、
   `test-fixtures.mjs`）でのテストであり、本物のカメラ写真は一枚も使っていない。特に:
   - `detectPaperQuad`の「高輝度・低彩度＝紙」ヒューリスティックは、白い机やLED照明の
     色被りがある実写環境で誤検出する可能性が高い。→ 手動四隅調整UIが実質的な安全網。
   - `inkMask`のOtsu閾値クランプ(40-200)は実写の影・反射で破綻しうる。
2. **ライブAR追従は実機で一度もテストしていない**。Playwrightの
   `--use-fake-device-for-media-stream`（Chromeの合成テストパターン映像）で
   getUserMedia〜スキャン〜追従ループまで例外なく動くことは確認し、さらに`trackAR()`が
   使う回転・スケール導出式（`atan2(vec.x,-vec.y)`と`dist/(outH*0.08)`）は既知の角度・倍率で
   回転/拡大した合成クアッドに対して数値的に完全一致することを確認済み（誤差0.00度）。
   つまり**数式自体は検証済み**。ただし実際の紙・実際の手ブレ・実カメラのフレームレート
   ゆらぎでの体感精度・fpsは未検証。特にiOS Safariでの`getUserMedia`・
   `MediaStreamAudioDestinationNode`・`captureStream`の実装差は要確認。
3. **AR中の録画は映像とキャラクターのみ**。静止画モードの「紙に残る穴」演出はAR中は
   意図的に省略（ライブ映像に穴を合成する処理は未実装）。
4. **画面回転・向き変更への追従は未対応**。AR中に端末を回転すると`ar.quad`の座標系
   （スキャン時のinnerWidth×innerHeight）と新しいビューポートがズレる。今回は対応せず。
5. **ARの録画中は`speaking`中のバウンス演出とWeb Audioブリップ音のタイミングが
   厳密には同期していない**（`say()`から独立して発火するため）。
6. Playwrightでの検証は Chrome (system channel) のみ。Safari/iOS固有の挙動
   （EXIF・getUserMedia制約・speechSynthesisのユーザー操作起点要件など）は未確認。
7. 関節推定は引き続き幾何ヒューリスティックのみ（AnimatedDrawings統合は未着手、下記
   「monorepo化するときのマッピング」は変更なし）。
8. ARAPではなくLBS（関節付近で多少潰れる）。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `core.js` | 純粋ロジック。二値化＋彩度救済 → 複数成分統合(assembleCreature) → bbox →
  15関節ヒューリスティック → traits → グリッドメッシュ+LBS。加えて紙四隅検出
  (`detectPaperQuad`)・射影ホモグラフィ(`squareToQuadHomography`/`warpQuadToRect`)・
  決定的PRNG(`mulberry32`)。 |
| `index.html` | UI・レンダラ・アニメーション・音声・録画・AR。
  HOME→(CORNERS)→LOADING→FOUND(+Debug)→LIVE(desk or AR) |
| `test-core.mjs` | golden path（棒人間/腕なし/落書き/白紙、全PASS、seed固定） |
| `test-fk.mjs` | FKの静止ポーズ再現・walkサイクル有限性・骨長保存・行列端点一致 |
| `test-paper.mjs` | ホモグラフィ往復検証＋紙検出（高コントラスト/回転/低コントラスト） |
| `test-fixtures.mjs` | 実写を模した合成フィクスチャ9種（**実写ではない、上記注記参照**） |
| `LICENSE` | MIT |
| `PRIVACY.md` | ブラウザ内完結・無送信の説明 |
| `README.md` | 公開用フロントページ（本ファイルは開発者向け詳細メモ） |
| `manifest.json` / `sw.js` / `icons/` | PWA化：ホーム画面追加・オフライン動作 |

## monorepo化するときのマッピング（変更なし、まだやらない）

- `core.js` → `packages/vision`（マスク/関節/紙検出）＋ `packages/rig`（メッシュ/スキニング）
- `index.html`の POSES/timeline → `packages/motion`、Character.draw/drawTri → `packages/renderer`
- AR追従ロジック(`trackAR`) → 将来`packages/ar-tracking`として独立させやすい形にしてある
  （`squareToQuadHomography`/`mapUnitSquareToQuad`はDOM非依存）
- 台詞・traits反応 → `packages/core`の`LocalCharacterBrain`
- SDK: `new SketchAlive({container})` / `fromImage` / `enter` / `escape` / `say` / `play`

## セキュリティ/ライセンスの注意

- 画像・カメラ映像はすべてクライアント内で処理、サーバ送信なし（`PRIVACY.md`参照）
- SVGアップロード禁止・MIME検証は今回`loadImageAsCanvas`で`file.type`チェックのみ追加
  （API化する場合は別途強化必要）
- AnimatedDrawings統合時は MIT LICENSE / THIRD_PARTY_NOTICES.md を追加すること
