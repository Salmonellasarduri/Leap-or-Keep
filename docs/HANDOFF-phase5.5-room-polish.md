# HANDOFF: Phase 5.5 — GLB部屋のSol磨き+経済憲章の残り

> 2026-07-14 作成(Phase 2〜5完走セッション=Fable 5からの引継ぎ)。次セッションは**Sonnet 5等**で(Fable枠は7/13以降サブスク外)。
> まずこのファイルと `docs/design-phase2-holo.md`(§5-6+Phase5節=全実装記録)を読むこと。
> バランスに触るなら先に `docs/design-economy-charter.md` と memory の rule-design-principles を読む(オーナー指示「忘れるな」)。
>
> **⚠ ROADMAP.md だけでは残作業を取りこぼす**: ROADMAP.md は2026-06のコンテンツエンジン転換で更新が止まっており、Phase 2〜5の視覚作業・経済憲章・Sol協業ワークフローを一切含まない。**残作業の正本は下の「残作業 全体マップ」**。この節が本ファイルの入口。

## 残作業 全体マップ(次セッションの正本 — 2026-07-14 時点)

> 記号: ✅済 / 🔶一部 / ⏳未着手 / ⏸見送り中。各項目に「場所(詳細)」と「完了の目安」。
> 優先度は A(視覚の続き=最優先)> B(経済=バランスシム必須)> C(コンテンツ)。D は常時運用。

### A. 視覚 / 部屋(最優先の続き)
- **A1 ✅ 部屋Sol磨き → ゲーム内7.9/10(2026-07-14、昇格ゲート7.8突破)** — テーマ憲章 `docs/design-room-theme.md` を策定(コンセプトアートの5柱)。**決定的レバーはCyclesでなくthree.jsの照明**(GLBはCyclesライトを持ち込まない=Solの盲点)。Sol独立監査ループで 4.6→6.6→7.0→7.9(暖⇔冷1.8/暖色プール1.8/深度1.6/物質感1.3/道具1.4)。処方: 暖色タングステンSpot(#FF9A4D/1050/decay2/左ベンチ照準)+冷色Hemisphere0.32+冷色リアリム+正面フィル+フォグ+CSSヴィネット+露出0.90(holo.js roomBuild)。モデル(Sol R6/R7): 暖色マテリアル/ハザード縞/リベット/擦り傷/articulatedランプ(salvage_desk.py, GLB 625KB)。**8.3未達の残**: 物質感(procedural roughnessはGLB非export=texベイクが要)+窓/卓中央のHUD/盤遮蔽=in-game天井が2D画8.5より低い(Sol指摘)。
- **A2 ✅ 部屋を既定背景へ昇格(2026-07-14)** — `roomWanted()`で既定ON(META.room3d===false/?room=0でOFF、?room=1でON)。タイトルにトグル「🛰 立体卓/🖼 平面卓」+i18n。**ラン中ライブ切替**(roomReconcileが毎フレーム調停=リロード不要でラン維持)。2D画は自動フォールバック維持(GLB失敗/WebGL不可)。fps: 既定ON=モバイル経路必須 → **dirty-renderスキップ(静止フレームは再描画せずpreserveで保持)**でbeat p95 16.8ms合格(素の33ms/166msヒッチを解消)。検証: defaultOn=true/off→2D/on→部屋・エラー0。
- **A3 ⏳ 全画面3D/UIの未実装分** — design-phase2-holo §未実装: 使用不可半面の理由表示/①②スロットバッジ/射程グリフ刷新/ゴースト(.dghost等)の3D化/カメラ微パララックス/モバイル視差(deviceorientation)/P9 HUD観賞トグル/P10 下部光源リワード/遷移の意味文法/ダイエジェティック全画面リスキン/モバイル端末シート化(Sol Phase3.5 §3)。

### B. 経済(charter §2 — 変更前に3方策シム前後比較 必須。L-008)
> **設計はSol主導→4観点で敵対的監査→Sol v2で改訂**という流れで確定(2026-07-14)。設計正本: `tmp/sol-econ-concept-v2.md`(tmp=gitignore、消えていたら再質問)。
- **B1 ✅ 整備ドック(2026-07-14, ラン内クレジット新設で実装)** — `run.credits`(earn/spend保存則)+二段ドック(①無料主作業→②有料: 応急溶接₢3=HP+1/ブラックボックス回収₢7=ロスト1枚復帰)+緊急解体(非常弁・素価値)+残額を勝敗共通で1:1メタ持越。入口は危険ルート第2戦域クリアのみ(ZONE1-3=₢2/ZONE4-9=₢1、1ラン新規発行~₢12)。sim/agent両ハーネス(二段ドック駆動+合法手列挙)改修済み。331 sim/305 agent緑・win率不変(加算非破壊)・EN済。
- **pre0 ✅ 集中/安全帰還を精算で実払い(2026-07-14, commit 6eb7b54, オーナー承認: 案A)** — 集中型封印×1.5/2.0と安全帰還+20%は旧実装だと `cargoPayoutValue`(プレビュー/スコア)にしか無く、実精算(bonusValue×mult+遺物ごとsellRelic value×mult)は1円も払っていなかった=既存バグ(約束>実支給)。`settlementValue(state, relicIds)` 新設で実払い。個別売却額=限界寄与(望遠鏡和)で売却順・分割インストール不変。プレビュー=実支給が一致(実機: 26約束→26支給、旧18)。収入~1.5倍の加算(非破壊)、勝率シム不変(精算=勝敗後)。
- **B2 ✅ オランダ式ローテ市場(2026-07-14, commit a58f4ef)** — `marketQuote(base,misses)`(圧縮値下げB/B-3/B-5床+CB+2/+4/+6)。スパイク(≥₢18の4枚)を毎ラン1枚ローテ展示、連続禁止。misses++は「出撃時に展示品が買えたのに見送った(META.credits≥現価格)」時だけ=待てば必ず安くなる状態を廃止。非破壊UX(全カードは基準価格で購入可のまま、展示中1枚だけ回転割引)。META永続: marketFeatured/marketMisses。
- **B3 ✅ 見送り+展開持参金(2026-07-14, commit f82fcaa)** — 報酬に第3行動「見送り(skip)」=skip→dockRebate(次ドック整備を₢1×最大3値引き、購入で全量消費)=skipを死札にしない。持参金は**展開時のみ**・素の3遺物(coil/anchor/echo)だけ₢1・条件遺物と強遺物は₢0(situational性を守る)。deploy不可時はLOGICで拒否(保存則)。sim/agentにrelic_skip追加。
- **B4 ⏸ 展開側の逓減(同系統2つ目の展開は効果半減)** — 効果の一般化が難しく見送り中。
- **B5 (任意) 条件付きカードの拡充** — ✅3種実装済(背水回路/封印共鳴器/孤狼ドライブ、cardSpecのapplyCond)。条件種の追加は容易(COND_DEFSに足す)。

### C. コンテンツ / 露出(ROADMAP Phase B/C)
- **C1 🔶 エージェント実走検証の継続**(Phase B)。
- **C2 ⏳ 一気通貫記事「Claude→Blender→GLB→three.js(世界初)」** — 素材は揃った(design-phase2-holo Phase5節+Solログ+今回のSol-drive実証=書き込みモードでSolがBlender主導)。
- **C3 ⏳ Phase B2/C**: イナンナプレイ→記事(オーナー側)/ CF Workers動的OGカード/ランキング+HMAC(反応次第)。

### D. 運用(常時)
- **D1 ✅ Sol-drive**: レンダはSolに主導実行させる(§Sol協業レシピ)。Claudeが制約提示+GLB/ゲーム内整合+ゲート+公開。
- **D2 ✅ lessons機構**: 罠は tasks/lessons.md(現L-044)→ tools/lint-guards.mjs 等の機械ガードへ卒業(.claude/skills/lesson-record)。

## 現在地(v0.9.17→ +本セッション、main公開済み)

- 見た目の到達点: 全画面3D一人称空間(2canvas分割)+斜めUI言語(AK/EF/鳴潮)+コックピット近景。Sol評: 盤9.6 / カードUI9.8 / 空間8.8 / 斜めUI9.3
- 経済: ルールデザインノート統合済み(集中型封印×1.5/×2.0、安全帰還+20%、文脈ヒント、スパイク商品₢26)
- **GLB部屋**: **既定背景へ昇格済み(2026-07-14)**。Sol独立監査ループ 4.6→6.6→7.0→7.9→8.2→**8.3/10**(ゲーム内合成、暖⇔冷1.9)。決定的レバーはthree.js照明(Claude, holo.js roomBuild)+Solモデル R6/R7。トグル「🛰立体卓/🖼平面卓」でライブ切替、2D画(8.5)はフォールバック。fps: dirty-renderスキップでモバイル既定経路p95 16.8ms合格。8.3超えの残=物質感(texベイク要=procedural非export)+HUD/盤のin-game遮蔽が2D画8.5を上限に。詳細は `docs/design-room-theme.md`。

## 次タスク① 部屋のSol磨き(最優先) — R3-R5 実施済み、あと0.1で昇格ゲート

**2026-07-14 の進捗(6.8→7.7)**: 黒潰れは局所照明で約65%→大幅解消(背面壁ウォッシュ48W+中景リム38W+バスト背面灯18W+世界光床値1.1)、卓に前面フェイシア/四隅マウント座/セクション板/前左タグリーダー小物、ランプ暖色化(200W40°)、キャニスター白飛び抑制+内部リング、窓を上部へ移動。Solログ tmp/sol-room-r3〜r5.md(gitignore — 消えていたら再質問)。**残る7.8→8.5の具体処方(Sol R4/R5より、中央55%×43%は侵さない前提)**:
1. **窓が最終画面で読めない**(最大の未解決)。1280×720で可視領域を x=870-1240,y=10-165px に確保。シアン内枠12-18px、外宇宙を室内壁より0.7-1.0EV明るく、星/船影を最低3点。カメラ投影の当てが難しいので、Blender座標を数点試すよりカメラからの逆算 or 実レンダ確認ループで詰めるのが速い。
2. **ランプ暖色を「面」に**。スポット180-220W/38-42°/2800-3100K、左卓面に直径300-380pxの暖色プール(中心 x=175-220,y=275-330px)。右の寒色域と色温度差3500K。
3. **タグリーダー+周辺暗部を一体で救う**。本体を x=35-275px に収めフレーム切れ解消、画面見かけ110×28px・発光1.8-2.2、左前に25-35W/5000-6000Kの弱フィル、本体暗部を純黒→RGB8-15へ。ボルト最低3個判別でヒーロー判定。
4. Sol未対応だが有効: 卓面の製造履歴(Noiseで roughness 0.54-0.72 変調・外周摩耗マスク)は**GLBに焼けない**(procedural nodeは非export)ので、in-gameに効かせるならテクスチャベイク or 頂点/簡易UV。Cyclesレンダのスコアだけ上がる罠に注意。

Solの旧残指摘: **「黒潰れ解消と主役の情報密度」**(R3-R5で対処)。批評ログ: tmp/sol-room-r1〜r5.md(数値処方全文・tmp/はgitignoreなので消えていたら再質問)。

- シーン: `tools/blender/salvage_desk.py` の `--room` ブロック(Sol R2トップ5適用済み: 装甲ワークベンチ/デスクランプ/ガラス容器/コンソール/2灯)
- レンダ: `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -b -P tools/blender/salvage_desk.py -- --room --plate --render room --samples 128 --res 1280x720 --out tmp/blender`
- GLB出力: 同コマンドで `--glb art/salvage_room.glb`(--plateがゲームプレイ要素を抜く。export_apply=Trueでベベル適用済み)
- 配置確認は `--bright` フラグ(全体照明で診断)。**露出はレンダ設定部で--room時0.55に固定済み(0.18が上書きするバグは修正済み — 再発注意)**
- ゲーム内ライトは holo.js の roomBuild()(three側近似: spot琥珀260/Hemisphere0.5/point×3)。Cyclesとゲーム内の明るさは別物 — **必ず ?room=1 のゲーム内スクショで判定**
- in-gameスクショ雛形: このセッションで使った一発Playwrightスクリプト(過去ログ参照)か tools/shot.mjs に room シナリオを足す
- 合格したら: bgShow系の既定を room に切替(bg.matte フォールバック維持)+ META.room3d トグルをタイトルに追加(i18n追補を忘れずに)

### Sol協業レシピ(確立済み)

**① 批評モード(read-only)** — Solに採点・数値処方だけ出させる:
```bash
cd "E:/Project/Leap-or-Keep" && codex exec -s read-only --skip-git-repo-check \
  -i tmp/blender/salvage_desk_room.png -o tmp/sol-room-r3.md "質問文"
```
「10点満点+一言 / 改善トップNを数値で(bpyで実装可能なものだけ) / 出荷可否明言」の構造化質問が有効。2D画(art/deskbg.webp)を比較添付すると採点が安定する。

**② 主導モード(workspace-write)** — Solに `salvage_desk.py` を直接編集させ、Blenderも自分で回させる(2026-07-14実証。SolのBlender精度はClaude/Opusより高い):
```bash
codex exec -s workspace-write --skip-git-repo-check \
  -i tmp/blender/salvage_desk_room.png -i art/deskbg.webp < タスク.txt
```
- **プロンプトは必ず stdin パイプ(`< file`)。位置引数で渡すと背景実行で空振りする**(`No prompt provided via stdin`)。長文はファイル化。
- Codex設定は既に `approval_policy=never`/`danger-full-access` なので自走する(`~/.codex/config.toml`)。agmsg は挟まない(単発タスクに不要な間接化)。
- Solへ渡すタスクには **Blenderの絶対パス**と**レンダコマンド**を明記(自分の目で確認・反復させる)。

**③ 役割分担(重要)**: Sol=Blenderシーン/レンダの見た目/目標スコアへの反復。私(Claude)=Solに見えない側の担保:
- **GLB整合**: Solはレンダしか見ないので、`render_pre` ハンドラやカメラparentのような**レンダ専用手法を使いがち**(2026-07-14に窓で実際に踏んだ=レンダは8.3点だがGLBに窓ゼロ)。**タスクに「静的シーンジオメトリのみ・render_pre/カメラparent禁止=GLB(--glb)はレンダを走らせない」制約を必ず明記**する。渡した後 `strings art/salvage_room.glb | grep -o "win[a-z_]*"` で実際にGLBへ入ったか検算。
- **ゲーム内 `?room=1` 合成確認**(SolはDOM盤面の重なりも three.js の明るさ=Cyclesと別物 も見られない=罠L-040)、ゲート(sim/agent/i18n/lint)、commit/公開、Solがカメラ/光源を動かしたら `holo.js` roomCam/roomBuild 追従。
- Solが自作を自採点するので独立批評は消えるが、**最終ゲートはゲーム内スクショ(こちらが撮る)**で担保。

## 次タスク② 経済憲章の未実装分(design-economy-charter.md §2)

- ✅ **条件付きスパイク報酬カード(③-2)実装済み(2026-07-14, commit 35228cd)**: cardSpec に applyCond。lowlife(寿命≤5で2倍)/sealsync(封印数だけ+)/lonewolf(手札≤2で+2)の遺物3種。プール9→12=25%。専用sim9件+i18n。**残り3項目はいずれも現行構造だと中〜大改修が要る(下記の構造メモ必読)**:
- **ラン中の金の出口: 整備ドック(②-2a)** — ⚠ 現行 `credits` は**メタ専用**(精算で獲得→タイトルの格納庫で消費)。ラン中の出口にするには**ラン内クレジットプール**の新設が要る(獲得: 戦闘/サルベージ/ラン中の遺物売却、消費: 整備ドック ₢3=HP+1/₢7=ロスト回収、残額は精算でメタへ1:1持ち越し)。既存の「整備ドック」は `applyResupply`/`applyScrapLoot`/`applyUpgrade`=カード択(index.html 1811-1837付近)で金は絡まない。ここにクレジット択を足す形が最小。憲章「金の3本足」の要。
- **オランダ式市場(①-3)** — 売れ残りスパイクの値下がり/キャッシュバック。⚠ 格納庫(UNLOCK_POOL)は**メタ**。ラン跨ぎの値下がり記憶には META 側に「未購入回数」状態の永続が要る。
- **報酬の持参金+残念賞(③-3)** — ⚠ **構造ミスマッチ**: 現行報酬は「単一遺物の封印/展開」(resolveRelic, index.html 2458付近)で3択ではない。「取らなかった2枠にスクラップ」は3択前提。まず報酬を3択化するか、③-3を「単一遺物+持参金(癖の強い遺物の売却額に+₢、skip累積で増える)」へ翻案するのが現実的。
- 展開側の逓減(同系統2つ目の展開は効果半減)は未実装(効果の一般化が難しく見送った経緯あり)

## 次タスク③ その他バックログ

- モバイル端末シート化(Sol Phase3.5処方§3: 右カラム→下から開くホロシート)
- HUD観賞トグル(P9)/ 下部光源リワード(P10)/ 遷移の意味文法 / ダイエジェティック全画面リスキン
- 一気通貫記事の執筆(「Claude→Blender→GLB→three.js」世界初。素材: docs/design-phase2-holo.md Phase5節+各Solログ+レンダ)

## 検証ゲート(毎コミット)

```
npm test               # sim 294(N=200必須 — 少ないと統計2件が偽FAIL)
npm run test:agent     # 305
node tools/i18n-audit.mjs   # 残JPノード0(新規文言はEN_EXACT追補。ルールはEN_RULES.unshift — pushは汎用分割ルールに食われる)
node tools/fps.mjs     # ビートp95≤17.5ms+ヒッチ≤4。**マシン負荷に敏感 — FAILしたら単独実行で再計測**
node tools/shot.mjs tabletop   # 全画面フレーミング確認
```
盤整合は `window.__holo.calibCheck()`(閾値2.5px、現在0.31px)。実プレイ経路は tmp/e2e-holo-beat.mjs 系(tmp/はgitignore — 消えていたら過去コミットのdocs記録から再作成)。

## 罠(このセッションで実際に踏んだもの)

1. **LOGIC区間(index.htmlのLOGIC-START〜END)にDOM/import/three参照を入れると sim+agent 全滅**
2. i18nルールは `EN_RULES.unshift`(先頭)。`push` だと汎用「$1 — $2」分割ルールが先にマッチして届かない
3. holo3クラス付与はレイアウトを動かす → 盤canvas再キャリブ必須(bgShowのrAF再同期で対応済み — 同種のCSS追加時は注意)
4. bgカメラはpx空間(near10)とメートル空間(部屋)で near/far 切替が要る(roomCamで対応済み)
5. fps.mjs はBlender/複数Chromium並走で偽FAILする
6. crashsalvage系の仕様変更は agent/protocol.mjs の合法手列挙も同条件に(列挙した手が失敗するとagentテストが落ちる)
7. 日本語ファイル名はReadツール/PowerShellで壊れることがある — Get-ChildItemのオブジェクト経由でコピー

## 主要ファイル地図

- `index.html` — ゲーム全体(LOGIC区間424行付近〜/UI層/EN辞書補完はI18N-DICT-END直後)
- `holo.js` — 盤ホロ+背景シーン+GLB部屋(bgBuild/bgDraw/roomBuild/roomCam)
- `tools/blender/salvage_desk.py` — Blenderシーン(--room/--plate/--glb/--bright)
- `vendor/three/` — three r185+GLTFLoader系(bare specifier相対化済み)
- `docs/design-phase2-holo.md` — 全フェーズの設計・検証記録(正史)
- `docs/design-economy-charter.md` — 経済設計憲章 / `docs/design-ui-slant.md` — 斜めUI仕様
