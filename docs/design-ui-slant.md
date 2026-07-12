# Leap or Keep — Phase 4「斜め3D UI言語+コックピット感」HUD実装仕様

## 0. 前提(コードベース接地)

- 対象は `E:\Project\Leap-or-Keep\index.html`(CSS+レンダラ一体、4610行)と `holo.js`(背景canvas=`#holo-bg`、部屋視差は `bg.group` を `-mx*10 / +my*6`・lerp 0.06 で駆動、`holo.js:684-688`)。
- 全パターンは **`body.holo3` ゲート配下にのみ追加**(2Dフォールバックは現状Web UIのまま=既存方針を踏襲)。
- **filter制約(L-030)**: `#board`/`#boardwrap`/セル/ユニットのpreserve-3d文脈では `filter`/`drop-shadow` 禁止(`index.html:131,173`)。本仕様の装飾は全て background / box-shadow / clip-path / backdrop-filter(`#side`で実績あり)で構成。
- **色**: 現CSS変数は `--cyan:#39d0ff / --amber:#ffb347`。指定基調(ティール#2E8E91/シアン#73D8D5/アンバー#E7A85B)は**新設トークン `--lk-*` に隔離**し、Phase4追加要素だけが参照する(既存要素の色は動かさない。#73D8D5は既に船骸縁光 `holo.js:609` で使用済=背景絵と同族)。
- 日本語テキストは常に主表記。英字は「型番文法」の装飾としてのみ追加。

---

## 1. 斜め言語の一貫性ルール(全要素共通・最初に:rootへ)

```css
:root{
  /* 角度語彙 — 画面に存在してよい角度はこの4種のみ。中間角の新設禁止 */
  --lk-skew: -8deg;      /* 2D浅斜め: チップ・タブ・ゲージセグメント(AK ±10°文法の可読安全側) */
  --lk-yaw: -3deg;       /* 空間傾き: 投影端末の既存値。左に置く物は +3deg で対称 */
  --lk-diag: -45deg;     /* ストライプ/特権形状専用 */
  --lk-paper: 2.5deg;    /* 「置かれた紙・カード」の乱雑角(±) — 現状は手札扇(--fan)が担当 */
  /* カット寸法 */
  --lk-cut: 10px;        /* コーナーカット。1要素1隅(基本=右上)。全要素共通 */
  --lk-bracket-w: 16px;  --lk-bracket-t: 2px;  /* コーナーブラケット(既存 #side::before と同値) */
  --lk-tick: 6px;        /* 計器プレート四隅ティック */
  /* Phase4専用色 */
  --lk-teal:#2E8E91; --lk-cyan:#73D8D5; --lk-amber:#E7A85B;
  --bracket-c: var(--lk-cyan);  /* モード切替はこの1変数で(P4) */
}
@media (max-width:620px){ :root{ --lk-cut:7px; } }
```

**規律(全パターンに優先)**
1. **skewはコンテナのみ**。テキスト・アイコン・数字は子spanで逆skew(`skewX(8deg)`)して常に水平。アイコンは1セット1スタイル・水平維持(鳴潮の反面教訓)。
2. **カットは1要素1隅**、寸法は `--lk-cut` 共通。カットと `border-radius` の併存禁止(カット採用要素は角丸4px以下へ)。
3. **45°は特権**: 「⚔ 敵ターンへ」確定ボタン1個だけが45°カットの六角特権形状を持つ。他要素への45°形状の使用禁止(ストライプ背景は例外)。
4. **グロー(発光box-shadow)は1画面同時1箇所**。確定チップのパルス点灯中は `#side::after` エミッタ線を opacity .4 に減光。
5. **盤面矩形(#boardwrapのbbox)にはいかなる装飾も交差させない**(Into the Breach原則)。
6. 空間傾き(`--lk-yaw`)はDOMパネル筐体のみ。文字ブロック単体に空間回転をかけない。
7. 揺れ(shake系)はcanvasと近景レイヤーのみ。**#hud/#side/#promptのテキスト層には適用しない**(Elite Dangerous反面教訓)。

---

## 2. 適用パターン(優先順)

### P1. 上部HUDの計器プレート化 【最優先・CSSのみ・レイアウト不変】
- **対象**: `#hud`(index.html:3010-3017 / CSS :152)、`.lifebar .seg`(:154-155)
- **具体CSS**:
```css
body.holo3 #hud{position:relative; padding:8px 14px;
  border:1px solid rgba(115,216,213,.28);
  clip-path:polygon(0 0, calc(100% - var(--lk-cut)) 0, 100% var(--lk-cut), 100% 100%, 0 100%);
  background:linear-gradient(180deg, rgba(5,17,35,.72), rgba(5,17,35,.50));}
body.holo3 #hud::before{content:""; position:absolute; inset:0; pointer-events:none; opacity:.55;
  background: /* 四隅ティック8枚 — #side::before と同一手法・var(--lk-tick) x var(--lk-bracket-t) */
    linear-gradient(var(--bracket-c),var(--bracket-c)) left 0 top 0/var(--lk-tick) var(--lk-bracket-t) no-repeat,
    linear-gradient(var(--bracket-c),var(--bracket-c)) left 0 top 0/var(--lk-bracket-t) var(--lk-tick) no-repeat,
    /* …残り6枚(right top / left bottom / right bottom) */ ;}
body.holo3 #hud .num, body.holo3 #hud span{font-variant-numeric:tabular-nums;}
body.holo3 .lifebar .seg{transform:skewX(var(--lk-skew)); border-radius:1px;} /* 14×20px既存寸法のまま */
/* 極小英字キャプション(装飾。日本語主表記は不変) */
.gcap{display:block; font-size:9px; line-height:1; transform:scale(.78); transform-origin:left bottom;
  letter-spacing:.24em; color:rgba(115,216,213,.55); font-family:monospace;}
```
  renderTop側で各計器spanに `<i class="gcap">SECTOR</i>` / `HULL` / `DECK` / `LIFE` を追加(ZONE表記・🚀・🂠・寿命ゲージの直上)。
- **期待効果**: HUDが「文字列の行」から「機材の計器窓」へ(EF計器プレート+AK型番文法)。セグメント寿命ゲージの平行四辺形化で斜め言語の起点になる。位置・DOM構造不変=鳴潮Ver3.3型「レイアウト不変ポリッシュ」で最低リスク。
- **リスク**: flex-wrap折返し時(モバイル)にプレートが2行を囲んで間延び → ≤620pxでティック非表示・padding 6px 10px に縮小。`scale()`キャプションは実寸ボックスが残るため `line-height:1` 必須。

### P2. 行動チップの平行四辺形化+確定パルス
- **対象**: renderBattleのチップ行(index.html:3571 のインラインstyle div → `id="chips"` を付与)、`H.chipClick`ボタン群
- **具体CSS**:
```css
body.holo3 #chips button{border-radius:0; transform:skewX(var(--lk-skew));
  border:1px solid rgba(115,216,213,.35); margin:0 2px;}
body.holo3 #chips button>span{display:inline-block; transform:skewX(8deg);} /* ラベル水平化・必須 */
body.holo3 #chips button.cue{position:relative;}
body.holo3 #chips button.cue::after{content:""; position:absolute; inset:-4px;
  border:1px solid var(--lk-amber); animation:chippulse .9s ease-out infinite;}
@keyframes chippulse{from{transform:scale(1);opacity:.9} to{transform:scale(1.26);opacity:0}}
/* 特権形状: ⚔敵ターンへ(45°カット六角) */
body.holo3 #chips button.endturn{transform:none;
  clip-path:polygon(12px 0,calc(100% - 12px) 0,100% 50%,calc(100% - 12px) 100%,12px 100%,0 50%);
  border:none; box-shadow:inset 0 0 0 1px var(--lk-amber); padding:8px 22px;}
```
- **期待効果**: AK「押せる物=単純多角形」+出撃ボタンパルス(ak-ui実測38→90pxの縮小版)。cueパルスが「ここが最終確定」の常時アフォーダンス。
- **リスク**: skewでヒット領域も傾く(端のクリックずれ)→ 横margin+2pxで緩和。ラベルの逆skew漏れは日本語可読性を直撃するため**全ラベルspan包みが前提**(renderBattle側の1行修正)。旧`.cue`アニメと二重発火しないよう holo3 では旧定義を無効化。規律4により、パルス点灯中は `#side::after` を減光。

### P3. #promptピル → ダッシュ導線付き計器ピル
- **対象**: `#prompt`(CSS :320 / 暗色ピル既存定義 :206-208)
- **具体CSS**:
```css
body.holo3 #prompt{display:flex; width:fit-content; margin:6px auto 0; align-items:center; gap:8px;
  border:1px solid var(--prompt-ring, rgba(115,216,213,.30)); border-radius:999px;
  padding:6px 18px 6px 14px; background:rgba(3,9,18,.72);}
body.holo3 #prompt::before{content:""; width:26px; height:1px; flex:none; opacity:.6;
  background:repeating-linear-gradient(90deg, var(--lk-cyan) 0 6px, transparent 6px 10px);}
body.holo3.sel-wait #prompt{--prompt-ring: rgba(231,168,91,.45);} /* 1枚目選択済=2枚目待ち */
```
- **期待効果**: EF署名CTA「ピル+ダッシュ導線」。指示文が指示装置になり、状態(選択待ち)が枠色で伝わる。
- **リスク**: 既存 `display:table` センタリングとの置換でレイアウトシフト → `min-height:2.4em` 温存。`.sub` エラーメッセージ表示時の高さ変動は既存挙動のまま。

### P4. 投影端末のモード文法+//接頭辞+枠伸長 — #side
- **対象**: `body.holo3 #side`(既存の単一筐体 rotateY(-3°)・ブラケット・エミッタ線 :460-481)
- **具体CSS**:
```css
body.holo3 #side h3::before{content:"// "; color:rgba(115,216,213,.45);}
/* 既存::beforeの8枚グラデの色 #49d5ff を var(--bracket-c) に置換した上で: */
body.holo3.enemy-turn #side{border-color:rgba(231,168,91,.40); --bracket-c:var(--lk-amber);}
body.holo3 .intent{transition:box-shadow .15s ease-out;}
body.holo3 .intent:hover{box-shadow:inset 3px 0 0 var(--lk-amber);} /* 枠の微伸長(AK) */
```
  `enemy-turn` クラスは gaze-lean と同じ付与箇所(敵手番開始/終了フック)で付け外し。
- **期待効果**: Elite Dangerousの「ブラケット色+形=モード表示」。敵手番が文字を読まずに伝わり、背景の「相手の眼の加熱」(holo.js:680-683)とDOM側が同期する。
- **リスク**: 既存::beforeはグラデ8枚のハードコード色 → **先に `--bracket-c` 変数化のリファクタを済ませてから**着手(差分最小化)。h3見出しは日本語のまま(//は接頭辞のみ)。

### P5. パネル・モーダルのコーナーカット統一
- **対象**: `.modal`(:341)、戦闘外画面の `.panel`(:3071以降で多用)
- **具体CSS**: `clip-path:polygon(0 0, calc(100% - var(--lk-cut)) 0, 100% var(--lk-cut), 100% 100%, 0 100%); border-radius:4px;`
- **期待効果**: 全画面が「同じ工具で切った」統一感(規律2の実施本体)。
- **リスク**: **clip-pathはbox-shadowを切り落とす** → .modalの影は背後の `.modalwrap` 側へ移すか影なし+borderで代替。`.card` には適用しない(手札の角丸は掴みやすさに寄与。EFも「情報部は直交・装飾は限定」)。

### P6. グリーブル装飾層(独立1枚)
- **対象**: 新規 `#greeble`(`position:fixed; inset:0; pointer-events:none;` z-indexは `#holo-bg`(-1)より上・`#app` より下=0)
- **内容/CSS**: 左下にビルドコード `LK_REL_0.9.x / SEED-xxxx`(font:10px monospace; opacity:.3)、右端に縦回転英字(`writing-mode:vertical-rl; letter-spacing:.3em; opacity:.18`)、上端中央にコンパス目盛り(`repeating-linear-gradient(90deg, rgba(115,216,213,.35) 0 1px, transparent 1px 7px)` を高さ4pxの帯に)。**英字のみ**(日本語のゲーム情報をここに置かない=情報と装飾の分離)。
- **期待効果**: EF「同心円的密度制御」— 盤(中心)から遠い縁ほど細かく薄い印字。機材のフチ感でコックピット化に直結。
- **リスク**: opacity上限 .4 厳守(情報と誤認させない)。390pxでは左下ビルドコードのみ残し他は非表示。

### P7. フレーム=状態表示(船体損傷の身体化)
- **対象**: 新規 `#cockpit-frame`(P8と対、DOM側最前面 `pointer-events:none`)+ `body.hull-crit`(hullNow≤sd.hp/3、renderTopの既存判定 :3012 と同条件で付与)
- **具体CSS**: 四隅に `radial-gradient(ellipse at 0 0, rgba(255,85,102,.14), transparent 55%)` のビネット+ひびSVG(data-URI・2段階)を右上1箇所。被弾イベント時のみ `opacity 0→.12→0` の0.3s白フラッシュ(`mix-blend-mode:screen`)。
- **期待効果**: Elite Dangerous「キャノピー損傷」文法。危機を「自分を守るガラスの損傷」として体感させる。イベント駆動・希薄・短命(Metroid Prime原則)。
- **リスク**: 常時ひび表示は「画面の汚れ」化 → hull回復で即除去。フラッシュは `prefers-reduced-motion` で無効。

### P8. コックピット近景レイヤー(three.js `#holo-bg` 側)【必須要件】
- **対象**: `holo.js` の bg セクションに `bg.nearGroup` を新設(`bg.scene` 直下・`bg.group` とは別)。
- **仕様**:
  - **構成**: (i) 四隅シルエット4枚 — `ShapeGeometry`、色 `0x020609`・opacity .85(船骸 :605-606 と同素材文法)+縁光 `EdgesGeometry` の `LineSegments`(`0x73d8d5`・opacity .12・AdditiveBlending)。各シルエットは**画面幅22%×高さ18%以内・画面辺中央と #boardwrap bbox に交差しない**(四隅限定=Metroid Prime原則)。(ii) 下端コンソール縁 — 全幅×高さ8-10vh相当の台形メッシュ(上辺が狭い)、上辺に沿う1px相当のティール縁光線。deskbg.webp の卓前縁と重なる位置に置き「絵と実体の二重化」で近景感を出す。
  - **配置**: z=+40(matteはz=0、カメラz=2000・fovは「z=0平面でワールド=CSSpx」:654)。近景はスケール補正 `(2000-40)/2000≒0.98` を掛けて画面上の狙い寸法を維持。
  - **視差**: 部屋 `bg.group` が `-mx*10 / +my*6` なのに対し、`nearGroup` は **`-mx*22 / +my*13`(同方向・約2.2倍振幅)**。「フレーム>操作卓>部屋>星空」の多層係数の最上段。lerpは既存と同じ 0.06。`META.fxLite` と `prefers-reduced-motion` では既存 `par` 変数(:685)に相乗りして0。
  - **gaze-lean連動**: 部屋が scale 0.985 に後退するとき(:692)、nearGroup は **scale 1.008**(乗り出すと近景は迫る=相対運動の増幅)。
  - **shake**: `#holo-canvas.shake` 系のミラーとして nearGroup.position に減衰正弦を加算してよい。**DOMテキスト層には適用禁止**(規律7)。
  - **モバイル390px**: 四隅シルエット非表示、下端コンソール縁のみ(視界圧迫回避)。
  - **フォールバック**: holo3無効時は何も追加しない(deskbg.webpの絵が既に卓縁を持つ)。
- **期待効果**: 「自分の頭がガラスの内側にある」奥行き手がかり。視点が浮遊カメラから座席に変わる(Squadrons「卓の縁+私物」文法。私物小物メッシュは後続で追加可能=アンロック報酬候補)。
- **リスク**: 四隅を大きくしすぎると即「視界不良」クレーム系の不快感(MechWarrior系mod事例)→ 上限寸法を守る。unlit素材のみ使用(盤ホロとのトーン混在なし=既存方針 :531)。

### P9. HUD観賞トグル(全消し)
- **対象**: 設定に「没入モード」を追加。`body.viewmode #app > :not(#boardwrap){opacity:0; pointer-events:none; transition:opacity .4s;}`
- **期待効果**: 鳴潮Ver2.0文法。常時UIの必然性の洗い出し(消して困らない表示の検出)にもなる。
- **リスク**: 復帰導線を必ず1個残す(Esc/画面タップで復帰)。優先度低・工数小。

### P10. 下部光源リワード演出
- **対象**: 帰還精算/戦利品モーダル(renderResult系 :3997以降)
- **具体CSS**: モーダル背後オーバーレイに `radial-gradient(ellipse at 50% 110%, rgba(231,168,91,.30), transparent 60%)`+戦利品カードに下→上の縁光グラデ。
- **期待効果**: AK「フットライト」文法で獲得物を展示物化。
- **リスク**: 低(全画面イベント時のみ・盤面と非共存)。

---

## 3. 実装順序と検証

- P1→P4はCSS主体・レイアウト不変で1コミットずつ(鳴潮型ポリッシュ=最低リスク帯)。P4着手前に `#side::before` の色変数化リファクタ。P8のみ holo.js 改修。
- 検証項目: (1) 390px幅で #hud 折返し時の枠形状とチップのタップ精度 (2) `META.fxLite` で近景視差が完全停止 (3) tiltモード(非holo)との共存=preserve-3d健在 (4) 既存テストスイートPASS維持 (5) グロー同時点灯が1箇所であること(確定パルス中のエミッタ減光)。

**関連ファイル**: `E:\Project\Leap-or-Keep\index.html`(全DOM/CSS)、`E:\Project\Leap-or-Keep\holo.js`(P8近景レイヤー、bg視差 :633-693)、`E:\Project\Leap-or-Keep\tasks\todo.md`(Phase4 = 既存タスク#10に対応)。