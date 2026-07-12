# Phase 2 設計 — ホロ盤面のリアルタイム3D化(Three.js)

> 2026-07-12 起草。`docs/HANDOFF-phase2-holo-board.md` の後継。実装前に敵対的レビュー済み。
> 前提の精密マップは並列読解ワークフロー(7エージェント)の成果に基づく。
> **2026-07-12 実装完了(スパイク)** — 検証結果は末尾 §4。実体: `holo.js` + `vendor/three/` + index.html のUI層フック。

## 4. 検証結果(2026-07-12、スパイク完了時)

| ゲート | 結果 |
|---|---|
| 投影整合(セル4隅bbox、閾値2.5px) | **PASS** — tilt34°: maxErr 0.26px / tilt0°: 0.25px(`window.__holo.calibCheck()`) |
| npm test / test:agent | **PASS** — 277 / 305(LOGIC区間無改変) |
| 実プレイ経路ビート(maybeRunDriftPhase自然駆動) | **PASS** — round進行+driftMoves=2+ソフトロックなし+エラー0(tmp/e2e-holo-beat.mjs) |
| file:// 劣化フォールバック | **PASS** — __holoFailed→DOM盤面のままround 2到達(tmp/e2e-file-fallback.mjs) |
| フレームタイム(tools/fps.mjs、モバイル390×844+CPU4x+DPR1.5キャップ確認) | **PASS** — idle p95 16.8ms / ビートp95 16.8ms・ヒッチ4。**同条件DOM版ベースラインは p95 33.4ms・ヒッチ7 = holo版の方が軽い** |
| EN深部カバレッジ | **PASS** — i18n-audit 残JPノード0(トグル文言はEN_EXACT補完) |
| 全シナリオ撮影(npm run shot) | **PASS** — 全22シナリオ出力(boss系の404はzone6-9アート未作成による既存プローブ) |
| ドリフトGIF | tools/gif.mjs chainhero 640px/75f/4.79MB — 3Dリング+火花+オーバーシュート滑走(R14経路発火確認) |

## 5. Phase 2.5 + カードUI改善(2026-07-12、オーナーフィードバック対応)

オーナー指摘3点(①半透明で2D背景がかぶる ②板を斜めにしただけで「宇宙が現出」していない ③カードUIが直感的でない)への対応。方針確定: **A(Phase 2.5)→B(Phase 3 一人称テーブル)の順**。

**Phase 2.5「卓上に宇宙を現出」(holo.js拡張)**
- 投影井戸: 盤直下に不透明近似の暗色プレート(Canvas生成feather縁、中心微青緑=Sol暗部3段階準拠)→ ①を根治
- 星屑3層(z=-14/-30/-46、緩慢ドリフト、透視パララックス)+ゾーン色相星雲(Canvas生成、加算α0.3)+四隅投影光柱(α0.05)
- 自機被弾で投影全体乱れ(透明度フラッター200ms — ジオメトリ不動でDOMラベル剥離なし)
- 外部アセットゼロ(全テクスチャCanvas生成)。fpsゲート影響なし(ビートp95 16.8ms維持)

**カードUI(Sol処方 tmp/sol-cardui-r1.md のP0+P1色)**
- 診断: 円系グリフ衝突+数字が単位を持たない=「暗号解読UI」。アイコン記憶に意味明示を委ねすぎ
- labelHtml全面改訂: アイコン→**文字ラベル**→数字の三重符号化(移動2/攻撃3|射程1)、語順固定(主効果→威力→射程→範囲→追加)、修飾タグ化(全周/直線/貫通/押出n…)
- カテゴリ色固定: 移動#55D8FF/攻撃#FF667A/射程#F2C94C/防御#58D68D/特殊#B98CFF。数字は白のまま
- 2枚選択ガイド: 1枚目選択後に「2枚目は▼戦闘面」を#promptで明示
- モバイル(≤620px)は攻撃/射程2行折返し+区切り棒非表示。EN辞書追補済み(監査0件)
- 未実装(P1後半〜P2、次段候補): 使用不可半面への理由表示 / ①②スロット・バッジ / 射程グリフ刷新 / アイコン語彙全面再設計

既知の残課題(次段):
- ゴースト類(.dghost/.mghost/.pvghost)はDOM絵文字のまま(スパイク方針どおり) — 3D化は次段判断
- 手前コマが奥セルのDOMラベルを隠せない構造限界(R11) — コマ高さ≤24pxで緩和済み
- カメラ微パララックスは未実装(--tilt変数を両層同時に振る方式で次段対応可能)
- fpsヒッチの根因は renderBattle の innerHTML 全再構築(DOM版由来) — 3D側の問題ではない

## 6. Phase 3 設計 — 全画面3D「一人称テーブル」(2026-07-12 着手)

最終構想(research doc C案)への一歩。**「ホロテーブルの実体化+マット背景方式」**:

- **D3-1 全画面canvas**: `position:fixed; inset:0; z-index:-1; pointer-events:none`。3D動作時は不透明描画で #deskbg/#zonebg を自然に覆う(CSS切替最小)。2Dフォールバックは不変
- **D3-2 マット背景**: Sol画(art/deskbg.webp)を遠景プレーンとして3D空間内に配置(映画のマットペインティング方式)。画の品質を守ったまま視差を得る。部屋を今すぐフルモデリングしない — Blender→GLBフル化は「一気通貫記事」の弾として Phase 3.5 に温存
- **D3-3 実体テーブル**: 盤の真下に3Dの投影台(台座+天板、鋼質感+シアンリム+四隅エミッタ)。「宇宙が現出する装置」の物理的根拠
- **D3-4 相手の実在**: テーブル奥に管制AIシルエット+発光眼(明滅)。Inscryption処方「相手の実在」の最小実装
- **D3-5 塵と暗幕**: 光条内の塵Points、手札域の暗幕(#deskbg.on::after代替)はシーン内クワッドへ
- **D3-6 整合の掟**: 盤とテーブルは不動(DOM整合0.3px維持)。パララックスは背景層と塵だけをマウスで±数px — 整合を壊さず奥行きだけ得る
- **D3-7 キャリブ**: boardwrap の getBoundingClientRect を毎フレーム参照し boardAnchor/視錐台を更新(スクロール・リサイズ・モバイルURLバー追従)

視線アンカー(手元/盤/窓)と道具UI全面化は Phase 3.5 以降(カメラ移動はDOM整合と衝突するため、アンカー実装はDOM側も同時に動かす設計が要る)。

### Phase 3a 実装記録(2026-07-13 完了)

敵対レビュー(2レンズ)が当初案「全画面fixed 1枚canvas」を棄却 — ①コンポジタ非同期スクロールでDOMラベルが必ず剥離 ②不透明天板がPhase 2.5の井戸を深度で全滅 ③deskbg.webpは完成した一人称卓画のため3Dテーブル追加=二重卓で破綻。採択された修正案:

- **2canvas分割**: 盤ホロ=既存boardwrapローカルcanvas無改変(整合0.26-0.29px温存)。背景=新設 #holo-bg(fixed全画面 z:-1、独自renderer、DPR≤1.25、AA off、unlitのみ=トーン混在なし)
- **絵が卓**: 3Dテーブルは作らない。マット平面(cover+下端揃え+sRGB一致+視差ぶんオーバースキャン1.05)に生命を注入:
  空椅子の闇に管制AIの眼(琥珀2点・呼吸明滅・瞬き)/ 窓外の船骸シルエット漂流(48s周期)/ ランプ光条の塵2層(視差深度差)/
  ランプのまれな明滅 / 窓のゾーン色相光(#zonebg非表示の補償)/ 盤下グロー(DOM盤rectを毎フレーム追従・読みのみ)
- **視差の掟(D3-6)**: 部屋(bg.group)だけがマウスで動く。盤・卓・盤下グローは不動 — DOM整合と無縁の層のみ動かす
- body.holo3 で #deskbg/#zonebg を visibility:hidden(.onクラスは温存=連動CSS生存)。手札暗幕は #holo-curtain(canvas直後のfixed div、DOM順で上)。#vig はDOM1本のまま(二重ビネット回避)
- ライフサイクル: bgInitはloadingガード付き(画像ロード中の再入で眼が4個になるバグを実測→修正)。bg死亡(contextlost/例外)は盤ホロを巻き込まずholo3のみ降格
- 検証: 277+305 PASS / fpsゲートPASS(ビートp95 16.9ms・bg追加コスト実測ゼロ)/ e2e整合0.03px / file://劣化OK / tabletopプリセット追加(tools/shot.mjs)

未着手(Phase 3.5候補): カメラ視線アンカー+道具UI化 / Blenderフル3D部屋(GLB — 一気通貫記事の弾として温存)/ タッチ端末の視差(deviceorientation)

### Phase 3.5 実装記録(2026-07-13 完了) — 道具UI化+視線アンカー

Sol処方(全文 tmp/sol-phase35-r1.md)に基づく。Web UI感の正体は装飾不足でなく「配置とシルエット」(同幅パネル縦積み・等間隔カードリスト)という診断が核心。

- **投影端末化(body.holo3限定)**: 右3パネルを1台の端末筐体に統合 — 外周フレーム1つ(rgba(73,213,255,.32))+内部は細区切り線、
  背景 rgba(5,17,35,.78→.58)+backdrop-filter blur(3px)で部屋が透ける、rotateY(-3°)+rotateX(.5°)、
  角ブラケット16px×8本+走査線(::before)、下辺エミッタ線+卓への投影光(::after)。intent項目は左アクセント線のみ。
  航行記録は内容追従(min40/max150px)+下端maskフェード=「空のtextarea」シルエット根絶
- **手札トレイ化**: renderBattleが枚数から--fan(±3°)/--fy(Y弧8px)を算出、重なり-9px、origin 50% 115%、
  共有接触影(#hand::after)、hover -12px/1.025/170ms、locked可読性回復(.45→.55+saturate)、faded半面.35→.5。
  デスクトップは1列扇(7枚折返し解消)、モバイル(≤620px)は横スクロールトレイ+scroll-snap
- **視線アンカー(Sol修正案)**: #app全体transform案は却下(ズームに見える/端クリップ/ぼけ)→「盤列と背景の相対運動」:
  敵ターン=#boardwrap scale(1.016)+translateY(4px)+背景3D層が1.5%後退・4%減光 / ドリフト=呼吸1回(1→1.012→1.006, 780ms, forwards)。
  盤canvasは#boardwrap内なのでDOM/3D整合は構造的に自動維持。prefers-reduced-motion対応
- **相手の呼応**: 敵ターン=眼の輝度1.35-1.6倍+暖色15-20%シフト(赤い警告灯にしない)、攻撃確定(flash/boom)で170msスパイク、
  意図リストホバー→3D機体の足元光増光(HOLO.hlUnit — DOM情報と空間内主体の同一性)
- 検証: 277+305 PASS / EN監査0件 / fpsゲートPASS(ビートp95 16.8ms) / e2e整合0.03px / 全24シナリオ撮影 / モバイル390px確認
- Sol判定: R2 **8.8/10「Go」— Web UI感1.2点はほぼ消滅**(残: 端末下部空白→内容追従で対応済み)

### Phase 4 実装記録(2026-07-13 完了) — 斜め3D UI言語+コックピット感

オーナー指名リファレンス(アークナイツ/エンドフィールド/鳴潮)を4系統並列Web調査(一次資料)→実装仕様に翻訳。
**調査全文: `docs/research-slant-ui.md` / 実装仕様(P1-P10+一貫性ルール): `docs/design-ui-slant.md`**。

調査の核: AKの斜めは「±10°スキュー」と「45°ダイヤ特権形状」の2種のみ/EFは「コンテナは水平、中身と背景帯を傾ける」+機材のフチ(グリーブル)/鳴潮の貢献は斜めでなく「UI=世界内デバイス」/コックピットは四隅限定+近景視差2倍+揺れをテキスト層に適用禁止。

実装(全て body.holo3 ゲート、P1-P8):
- 一貫性ルール: skew -8°(チップ・寿命ゲージ)/カット10px(1要素1隅)/45°系は特権1個/グロー同時1箇所/盤bbox不可侵
- P1 HUD計器プレート(枠+コーナーカット+四隅ティック+tabular-nums+平行四辺形セグメント)
- P2 行動チップ平行四辺形(**視覚箱だけ::beforeで傾け、テキストとヒット領域は水平** — AK反面教訓準拠)+⚔敵ターンへ=六角特権形状+パルス
- P3 #promptダッシュ導線 / P4 端末//接頭辞+敵ターンでブラケット琥珀化(--bracket-c変数化) / P5 モーダルカット統一
- P6 グリーブル(左下ビルドコード・右縦書き英字・上端目盛り — 英字のみ=情報と装飾の分離)
- P7-lite 船体危機で四隅赤ビネット(body.hull-crit、フレーム=状態表示)
- P8 コックピット近景レイヤー(holo.js bg.near): 上2隅シルエット+下端コンソール縁。部屋の2.2倍視差・リーン時1.008倍。
  Sol最終研磨適用: 前景明度+6-8%(0x0a141a)・縁光2pxクワッド・遮蔽影(三角1.07倍影絵+コンソール上方15pxストリップ)
- 検証: 277+305 PASS / EN監査0件 / fpsゲートPASS / e2e整合0.03px維持
- Sol判定: **9.3/10「出荷可」—「斜めが装飾ではなく操作・状態・モードの文法として統一された」**

Phase 4.5候補(未実装): P9 HUD観賞トグル / P10 下部光源リワード演出 / 遷移の意味文法 / ダイエジェティック全画面リスキン / Blenderフル3D部屋(GLB)

## 0. 訂正事項(HANDOFFからの差分)

- **盤面は 5×5**(`CONFIG.GRID=5`、奇数トーラス L-011)。HANDOFF/メモリの「4×4」は旧情報。実装は全て `CONFIG.GRID` 参照。
- three.js 実測: r185 は `three.module.min.js`(357KB/85KB gz)+ `three.core.min.js`(376KB/99KB gz)の2ファイル構成、計184KB gzip。

## 1. アーキテクチャ決定

### D1. DOM温存+投影一致カメラ(核心)

DOM盤面(セル・クリック・ツールチップ・日本語ラベル)は**一切動かさず**、holoモード時に
CSS で盤/セル/ユニットの「見た目だけ」透明化する。Three.js は同じ場所に、
**CSS 3D と数学的に同一の投影**で盤とコマを描く。

- CSS 投影モデル: `#boardwrap{perspective:1050px}`(origin=boardwrap中心・可変)+
  `#board.tilt{rotateX(var(--tilt)=34deg)}`(origin=board中心)+ `margin-top:-14px`
- Three 側: boardwrapローカルpx座標系でシーンを構築し、視点 `(Cx, Cy, 1050)`・
  非対称視錐台(`makePerspective` 手組み)で同一写像を再現
- キャリブレーション入力は**全て untransformed 値**(`offsetLeft/Top/Width/Height`)。
  毎 renderBattle 後+ResizeObserver で再計算(perspective原点が手札枚数等で動くため静的定数は不可)
- 検証: 「3D空間のセル中心を投影した点」と「DOMセル `getBoundingClientRect` 中心」の
  誤差 <2px を自動チェックする検証スクリプトを用意(tilt ON/OFF両方)

却下案: (a) canvasを盤の下に敷く — 盤・セルが不透明で不可視。
(b) tiltクラスを外しカメラ側だけで傾ける — DOMヒット面/ラベルと3D見た目が乖離し操作が壊れる。

### D2. canvasのライフサイクル

- canvas要素は**boot時に1個だけ生成**(WebGLコンテキストは再アタッチで生存)
- `renderBattle` が `app.innerHTML` を全置換するたび、新しい `#boardwrap` に
  `position:absolute; inset:-Npx; z-index:0; pointer-events:none` で再アタッチ
- `#boardwrap{position:relative}`・`#board{z-index:1}` を holo CSS で付与(DOMが上、canvasが下)
- battle/loadout 以外の画面では rAF ループを停止(電力・干渉ゼロ)

### D3. 状態同期 = 「メッシュ位置がFLIPのprevRects」方式

- HOLO は unit.id キーでメッシュを管理(undoTurn のディープコピーでオブジェクト同一性が壊れるため)
- 同期フックは `flip()` 冒頭に1行: wrapFx を splice する**前に** `HOLO.sync(ctx)` を呼ぶ
  (render() / maybeRunDriftPhase / maybeRunEnemyPhase の全経路が renderBattle→flip を通る)
- sync は毎回全量スナップショット+差分適用の冪等設計(ビート中の多重renderに耐える)
- 移動検知 = 「メッシュの現在グリッド座標 ≠ 状態の座標」→ 現在位置からトゥイーン。
  スナップショット別持ちは不要(メッシュ位置が前状態そのもの)
- wrap(縁越え)は wrapFx を sync 内で非破壊読取り(flip の splice より先に呼ばれる)
- fx ミラー: `drainFx()` の消費点に `HOLO.fx(ev)` を挿入(遅延イベント ev.d の再push後の
  消費点なので二重観測なし)。対象: boom(衝突・撃破)/ flash(発射)/ hitflash(被弾グリッチ)/
  shake(カメラ揺れ)/ stamp(ヒットストップ連動)
- ヒットストップ: drainFx の `*{animation-play-state:paused}` 注入箇所で `HOLO.hitStop(ms)` を併走

### D4. ドリフトビート(GIFの主役)

- `maybeRunDriftPhase` の構造・sleep(300/640)・UI.stepping 規約は**不変**
- 3Dトゥイーン: 駒滑走 500ms、イージングは慣性オーバーシュート
  (cubic-bezier(.22,.9,.32,1.18) 相当のカスタム)≤600ms で 640ms 予算内
- DOM側FLIP(透明ユニットのラベルが動く)は holo 時に同じ尺・同じベジェへ揃える
- 衝突(位置不変+boom fx): 進行方向へ 0.35 セルぶつかって跳ね返るバンプ+火花
- 縁越え: DOM の wrapJumpAnim と同相の2相(縁外へ退場 170ms → 反対縁から入場 430ms)
- ビート後 phase は `damage`/`crashsalvage`/`cleared` へ直行し得る — HOLO は phase を仮定しない
- 尺0ビート(ドリフト保有者ゼロ)は同期一気通貫 — トゥイーン0件で即整合

### D5. 見た目の分担(スパイク版)

| 要素 | 担当 | 実装 |
|---|---|---|
| タイル(基本/threat/charge/sel-ok/gravwell/flareRow/cue明滅/firing) | **3D** | InstancedMesh 25枚+per-instance color、sel-okは+10px浮上(DOMのtranslateZ(10px)と一致) |
| 盤の枠・グリッド線・ホロ発光 | **3D** | LineSegments+外周フレーム、加算合成 |
| コマ(自機/ドローン/敵/ハザード) | **3D** | type別プロシージャルプリミティブ+エミッシブ+浮遊ボブ+ちらつき |
| 名前・HPピップ・ドリフト矢印バッジ・行動順バッジ・dmgnum | DOM(温存) | 透明ユニットdiv内でそのまま |
| ツールチップ/クリック/dirpick/⛔/outline系(.intent-move/.hl/.actorsel) | DOM(温存) | 透明セルの上で従来通り |
| ゴースト(.dghost/.mghost/.pvghost) | DOM(温存) | スパイクでは据え置き(次段で3D化検討) |
| スキャンライン・微フリッカー | CSS | canvas上のオーバーレイ(GPU負荷ゼロ、L-030のfilter禁止に非抵触 — preserve-3d文脈外) |

色は Sol 指針: ティール `#2E8E91` 基調、明シアン `#73D8D5` はリム/選択のみ、
アンバー `#E7A85B`(charge/ドリフト)、コーラル `#D85C45` は threat 集中箇所のみ(面積≤1%)。
ゾーン色相 `--zh` をタイル基調色にブレンド。

### D6. 配布・フォールバック(README「ビルド・ネットワーク不要」保証の維持)

- three r185 を `vendor/three/` に2ファイルコミット+importmap。`THIRD_PARTY_LICENSES.md` にMIT追記
- HOLO本体は `holo.js`(ESM、リポジトリ直下)。index.html から `import("./holo.js")` を
  **動的import+catch** — file:// や WebGL不可なら **今日のDOM盤面がそのまま動く**(art/ と同じ劣化哲学)
- LOGIC区間(424〜2361行)には一切触れない → 277PASS+MCP基盤は構造的に無影響
- `META.holo`(既定true)+タイトル画面に `H.toggleHolo` ボタン(toggleTilt と同型)
- 初期化失敗時は META に関係なく自動でDOM盤面(body.holoクラスが付かない=CSS透明化も発動しない)

### D7. 性能予算

- draw call < 40(タイル1+線2+コマ≤12×2+fx少数)、ライト0灯(MeshBasicMaterial+加算)
- `devicePixelRatio` は min(実DPR, 1.5)
- rAFループは battle/loadout 表示中のみ。fxLite でフリッカー/パララックス停止+トゥイーン短縮
- 60fps計測は新規 `tools/fps.mjs`(ヘッドありChromium必須 — ヘッドレスはSwiftShaderで無意味)

### D8. 検証計画

1. `npm test`(N=200、277PASS)+ `npm run test:agent`(305PASS)— 毎コミット
2. 整合チェック: セル中心投影誤差<2px(tilt ON/OFF)を自動アサート
3. `tools/shot.mjs` に holo シナリオ追加(`window.__holoReady` フラグ+waitForFunction。固定delayは使わない)
4. ドリフトGIF: `tools/gif.mjs` 流用(lead/totalをトゥイーン尺に合わせ調整)
5. fps: tools/fps.mjs で通常時+ドリフトビート中を計測
6. Sol批評ループ(codex exec -i、10点満点+トップN改善の構造化質問)
7. main へは 60fps ゲート通過まで入れない(GH Pages即公開のため)

## 2. 敵対レビュー反映(2026-07-12、3レンズ全員 GO-with-fixes)

実装はここまでの D1-D8 を以下の修正込みで行う(全件根拠付きで検証済み):

**投影・描画整合**
- R1. 座標系: 射影でのY反転は禁止(ワインディング反転で全消滅)。ワールド変換 `y_scene=-y_px` で右手系を維持し、px→scene変換は単一関数に閉じ込める。CSS rotateX との符号対応もそこで吸収
- R2. near=100 / far=2400。z=0が投影平面であり near≠投影平面(近道すると浮上タイル・コマが全クリップ)
- R3. 重ね順: `body.holo #boardwrap>*{position:relative;z-index:1}`+canvasのみz:0。canvasのbleedは盤の投影域+コマ高さぶんに限定
- R4. holo時、`flip()`/`cellCenter()` のアニメ距離は offset(untransformed)座標で算出する分岐を追加(スクリーン座標流用だと tilt 34°でラベルが最大~20px剥離)。非holo時は現行のまま
- R5. shakeは3Dカメラで焚かない。canvas要素に同じ .shake系クラスを付け同一CSSアニメで揺らす(transform-originは盤中心に合わせる)
- R6. 透明化はプロパティ単位のチェックリストで行い、温存対象(.hl の inset box-shadow 等)は holo CSS の後段で再宣言して勝たせる。`#deskbg.on~#app #board` の接地影・`#board.tilt::after` 暗幕・cellcue背景アニメ・.firing背景も holo 時は無効化
- R7. boom系(ring/粒子/芯/ショック/焦げ)は holo 時 DOM 生成をスキップ(3Dに一本化)。dmgnum/fxfloat/stamp/chainx は DOM 温存
- R8. sel-ok 浮上(tiltのみ+10px)はコマも一緒に、トゥイーンなしスナップで(DOMのtransitionは全置換で発火しないため常にスナップ)。tilt OFF時は浮上なし+コマ高さを~1/3に抑える(視差ズレ対策)
- R9. スキャンラインは `body.holo #board::before`(盤と同寸・同じCSS変換配下)。fixed全画面は使わない
- R10. hover: `H.pv`/`H.pvOff` に HOLO.hover/hoverOff を1行ミラー
- R11. 既知の限界として記録: 手前の3Dコマは奥セルのDOMラベルを隠せない(DOM恒常前面)。コマ実高さ≤24px+ラベル下辺寄せで食い込みを1桁pxに抑える

**ライフサイクル・同期**
- R12. HOLO は最後に見た S.enc の**オブジェクト参照**を保持し、変わったら(新戦域・undo跨ぎ)トゥイーンなしの即時再構築。confirmLoad/tutorial/チャレンジ全経路を自動カバー
- R13. トゥイーン競合: 比較は「論理座標=進行中トゥイーンの目的地」のみ。開始位置は現在の視覚位置。retargetはcancel-and-replace(fxLiteの90ms連打syncで漸近クロール化するのを防ぐ)
- R14. ドリフト演出の発火判定は「**前回syncの enc.step が "drift"**」で導出(呼び出し元フラグ禁止 — gif.mjs の直接 LK.driftPhase 経路でも発火させる)
- R15. wrap 2相はDOMと同じ**並行**構成・総尺430ms(退場ゴースト170msと入場を同時開始、入場先頭40%ホールド)
- R16. 初期化完了時、battle中なら「アタッチ+全量sync+body.holo付与」を同一フレームで原子的に実行。`window.__holoReady`/`__holoFailed` はどの結末でも必ず立てる
- R17. rAFは #boardwrap が存在する時のみ(=battleのみ。loadoutに盤は無い)。キャリブはsync毎+window resize
- R18. ヒットストップは移動トゥイーンを止めない(DOMのWAAPIも止まらないため)。ボブ/ちらつき/パーティクルのみ停止

**互換・配布・検証**
- R19. 全HOLOフック(sync/fx/hitStop/hover)は `window.HOLO&&` ガード+try/catch。例外時は body.holo を外して恒久無効化(file://ソフトロック防止 — これが最重要ガード)
- R20. importmap 廃止。holo.js が `./vendor/three/three.module.min.js` を相対import(コア分割はvendor内で自己完結)。<head>無改変・Safari 16.0-16.3も救済
- R21. webglcontextlost: preventDefault+body.holo除去+rAF停止(即DOM復帰)。restoredで再init+sync
- R22. tools/playrun.mjs のMIMEマップに .js/.mjs 追加(現状 .html のみ → holoが起動せず視覚QAが嘘をつく)
- R23. shot/gif/i18n-audit は シナリオ実行前に `__holoReady||__holoFailed` を waitForFunction。DOM盤面基準の既存ベースラインは `lkDebug().META.holo=false` で明示指定可能にする
- R24. 整合チェック: セル4隅の3D投影bbox vs DOMセルrect bbox(閾値2.5px、中立状態、rAF×2、tilt ON/OFF両方)。`window.__holo={ready,project,calibCheck}` をデバッグ公開
- R25. fps計測は CPUスロットル4x+モバイルviewport(390×844)で、ドリフトビート中のフレームタイム p95<16.7ms を合否に
- R26. `.nojekyll` をコミット(GH Pages の vendor/ 配信保険)
- R27. holo失敗時: タイトルのトグルボタンをdisabled+理由tooltip。新規UI文字列は EN_RULES 追記+i18n-audit 0件確認
- R28. renderer alpha:true+加算合成の白飛び/黒縁はスパイク初日に deskbg あり/なし両方のスクショで確認

## 3. 実装順(スパイク)

1. vendor + importmap + 起動骨格(fallback確認: file://で従来表示)
2. キャリブレーション+タイル25枚+整合チェック(<2px)
3. コマ(プリミティブ+ボブ+ちらつき)+DOM透明化CSS+状態色
4. 移動トゥイーン(通常340ms/ドリフト500msオーバーシュート/wrap2相/衝突バンプ)
5. fxミラー(boom/flash/hitflash/shake/ヒットストップ)
6. トグル+fxLite対応+モバイルDPR
7. 検証一式(D8)
