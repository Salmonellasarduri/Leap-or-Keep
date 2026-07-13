# HANDOFF: Phase 5.5 — GLB部屋のSol磨き+経済憲章の残り

> 2026-07-14 作成(Phase 2〜5完走セッション=Fable 5からの引継ぎ)。次セッションは**Sonnet 5等**で(Fable枠は7/13以降サブスク外)。
> まずこのファイルと `docs/design-phase2-holo.md`(§5-6+Phase5節=全実装記録)を読むこと。
> バランスに触るなら先に `docs/design-economy-charter.md` と memory の rule-design-principles を読む(オーナー指示「忘れるな」)。

## 現在地(v0.9.17、main公開済み)

- 見た目の到達点: 全画面3D一人称空間(2canvas分割)+斜めUI言語(AK/EF/鳴潮)+コックピット近景。Sol評: 盤9.6 / カードUI9.8 / 空間8.8 / 斜めUI9.3
- 経済: ルールデザインノート統合済み(集中型封印×1.5/×2.0、安全帰還+20%、文脈ヒント、スパイク商品₢26)
- **GLB部屋**: `?room=1` の実験フラグで実動(Solゲート6.8/10通過)。既定背景は2D画(8.5)のまま — **6.8→8.5超えが本HANDOFFの主題**

## 次タスク① 部屋のSol磨き(最優先)

Solの残指摘: **「黒潰れ解消と主役の情報密度」**。批評ログ: tmp/sol-room-r1.md(数値処方全文・tmp/はgitignoreなので消えていたら再質問), r2はゲート判定のみ。

- シーン: `tools/blender/salvage_desk.py` の `--room` ブロック(Sol R2トップ5適用済み: 装甲ワークベンチ/デスクランプ/ガラス容器/コンソール/2灯)
- レンダ: `& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -b -P tools/blender/salvage_desk.py -- --room --plate --render room --samples 128 --res 1280x720 --out tmp/blender`
- GLB出力: 同コマンドで `--glb art/salvage_room.glb`(--plateがゲームプレイ要素を抜く。export_apply=Trueでベベル適用済み)
- 配置確認は `--bright` フラグ(全体照明で診断)。**露出はレンダ設定部で--room時0.55に固定済み(0.18が上書きするバグは修正済み — 再発注意)**
- ゲーム内ライトは holo.js の roomBuild()(three側近似: spot琥珀260/Hemisphere0.5/point×3)。Cyclesとゲーム内の明るさは別物 — **必ず ?room=1 のゲーム内スクショで判定**
- in-gameスクショ雛形: このセッションで使った一発Playwrightスクリプト(過去ログ参照)か tools/shot.mjs に room シナリオを足す
- 合格したら: bgShow系の既定を room に切替(bg.matte フォールバック維持)+ META.room3d トグルをタイトルに追加(i18n追補を忘れずに)

### Sol協業レシピ(確立済み)

```bash
cd "E:/Project/Leap-or-Keep" && codex exec -s read-only --skip-git-repo-check \
  -i tmp/blender/salvage_desk_room.png -o tmp/sol-room-r3.md "質問文"
```
「10点満点+一言 / 改善トップNを数値で(bpyで実装可能なものだけ) / 出荷可否明言」の構造化質問が有効。2D画(art/deskbg.webp)を比較添付すると採点が安定する。

## 次タスク② 経済憲章の未実装分(design-economy-charter.md §2)

- ラン中の金の出口: 整備ドック(₢3=HP+1 / ₢7=ロスト1枚回収)— ゾーン境界に配置。「金の3本足」の要
- オランダ式市場: 売れ残りスパイク商品の値下がり/キャッシュバック
- 報酬の持参金+残念賞(不人気候補に₢が自動で積む自己修正機構)
- 条件付きスパイク報酬カード(「残り寿命5枚以下なら威力2倍」系)を報酬プールの1/3へ
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
