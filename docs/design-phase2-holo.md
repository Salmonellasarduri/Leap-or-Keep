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

既知の残課題(次段):
- ゴースト類(.dghost/.mghost/.pvghost)はDOM絵文字のまま(スパイク方針どおり) — 3D化は次段判断
- 手前コマが奥セルのDOMラベルを隠せない構造限界(R11) — コマ高さ≤24pxで緩和済み
- カメラ微パララックスは未実装(--tilt変数を両層同時に振る方式で次段対応可能)
- fpsヒッチの根因は renderBattle の innerHTML 全再構築(DOM版由来) — 3D側の問題ではない

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
