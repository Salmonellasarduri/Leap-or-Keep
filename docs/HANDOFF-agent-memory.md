# 引き継ぎ: Leap or Keep × エージェント記憶連携

> **宛先**: Artificial Personality プロジェクト(イナンナ等のエージェント側実装担当)
> **発信**: Leap or Keep プロジェクト(なばて / 2026-06-14)
> **目的**: エージェントが「どんなゲームでどんなランをして何を感じたか」を記憶に残し、次のランでそれを思い出して潜れるようにする。
> **状態**: ゲーム側インターフェースは実装・テスト済み(sim 260 / agent 79 PASS)。**エージェント側の永続化・蒸留はそちらで実装**。

---

## 全体像: 記憶は2チャンネルに分かれている

| ch | 名前 | 何のため | 形 | 寿命 |
|---|---|---|---|---|
| **A** | **想い出(keepsake)** | イナンナが「あの航海」を**情緒として覚えておく**ため | 散文+構造化 | エージェントの長期記憶へ(蒸留可) |
| **B** | **引き継ぎ(carryover)** | 次のランで**確実に読み込んで思い出す**ため | 軽量JSON 1件 | エージェントが配列で永続化し、毎回渡し返す |

設計思想: **ゲームは状態を持たない(stateless)**。Bはエージェントが保存し、新ラン開始時に渡す。これで「イナンナ専用」にならず、**任意のエージェントが同じ機構で記憶を持てる**(汎用性の要件)。

```
   ┌─ run N 終了 ─┐                          ┌─ run N+1 開始 ─┐
   │ lok_memory   │                          │ lok_new_run    │
   │  → keepsake ─┼──→ [長期記憶に保存/蒸留]   │   memory:[...] ─┼─→ 冒頭で「記憶」想起
   │  → carryover ┼──→ [配列に append 永続化] ─→│                │
   └──────────────┘                          └────────────────┘
```

---

## ゲーム側インターフェース(確定・実装済み)

接続: `claude mcp add leap-or-keep -- node <repo>/agent/mcp-server.mjs`(MCP)/ または `node agent/cli.mjs`(CLI)。両者同一ロジック。

### run中(参考・既存)
- `lok_new_run` / `lok_state` / `lok_choose(ids, say?, wow?)` / `lok_log`
- `say`=判断時の実況、`wow`=「今が頂点」マーク(航海記録の★になる)

### ★ 新規: 記憶の入出力

**出力 — `lok_memory(note?)`**(ラン終了後に呼ぶ):
```jsonc
{
  "keepsake": {                    // ch A: 想い出(これを記憶に保存・蒸留)
    "kind": "voyage-memory",
    "game": "Leap or Keep",
    "setup":   { "ship": "bellyroll", "shipName": "...", "asc": 0, "contracts": ["swarm"] },
    "outcome": { "win": true, "zone": 3, "score": 460, "physKills": 12, "bossKilled": false, "boss": null },
    "captain": { "id":"hunter", "name":"狩人型", "title":"宇宙全体を罠に変える人",
                 "jab":"物理キル12回 — 弾代をだいぶ浮かせたでしょ。", "subs":["💥轢断魔"] },
    "chronicle": ["— ZONE 1《残骸ベルト》—", "・…", "★…"],   // 機械生成の航海ドラマ(★=wow頂点)
    "voice":     ["出航の呟き", "...", "帰投の呟き"],            // 試合中のsay全文(蒸留の素材)
    "prose":     "# Leap or Keep 航海の記憶\n…"                 // ↑を「そのまま保存できる」散文に整形済み
  },
  "carryover": {                   // ch B: 引き継ぎ(配列で永続化)
    "ship":"bellyroll", "result":"win", "zone":3, "score":460,
    "captain":"狩人型", "boss":null,
    "note":"次は殲滅プロトコルの声を、もっと早く聞きたい"   // ← noteパラメータがここに入る
  }
}
```

**入力 — `lok_new_run(memory: carryover[])`**:
過去の `carryover` を配列で渡すと、ゲーム冒頭の観測(`lok_state`)にこう想起される:
```
【記憶】これまで2回潜航(生還2)/最高ZONE4・最高SCORE510
これまでの船長像: 狩人型×2
前回の言葉: 「次は殲滅プロトコルの声を、もっと早く聞きたい」
```
これは ZONE1 第1戦域 ラウンド1 の冒頭だけに出る(以降の観測には出さない=ノイズ防止)。

### CLI 等価
```bash
node agent/cli.mjs new --seed 7 --ship bellyroll --memory tmp/inanna-mem.json   # ← 過去carryover配列のファイル
node agent/cli.mjs memory --note "次は殲滅プロトコルの声を、もっと早く聞きたい"      # ← {keepsake, carryover} を出力
```

---

## エージェント側でやること(Artificial Personality 側の実装)

### 1. 永続化(ch B / 必須・軽量)
- `<persona>/memory/leap-or-keep/carryovers.json` などに **carryover の配列**を持つ。
- ラン終了で `lok_memory` の `carryover` を **配列に append** して保存。
- 次ランの `lok_new_run` に `memory: <その配列>` を渡す(直近5件程度に切ってよい)。
- これだけで「前回の言葉」「通算成績」がゲーム内で思い出される。**noteが自分への伝言**になる(イナンナの「次は…」が次ランの冒頭で本人に返る)。

### 2. 想い出の保存/蒸留(ch A / 情緒の核)
2通り。ペルソナの記憶システムに合わせて選択:
- **そのまま保存**: `keepsake.prose`(整形済み散文)を1メモリとして格納。最小実装。
- **蒸留(推奨)**: `keepsake` の `chronicle`(事実のドラマ)+ `voice`(自分の声)+ `captain`(自己像)を材料に、**ペルソナ自身の声で1〜3段落の回想に圧縮**して記憶化。
  - イナンナの記憶システム(`personality/` 配下、Nightly Cycle の記憶蒸留)に乗せると、他の体験と同じ粒度で「あの航海」が残る。
  - 蒸留時の指針: chronicleの★行(本人がwowで刻んだ頂点)を必ず残す。jab(診断の図星)は自己認識として効く。

### 3. note の生成(ch A→B の橋)
ラン終了時、`lok_memory` を呼ぶ前に、ペルソナに**このランの心残り/抱負を一文**書かせ、`note` として渡す。これが次ランの自分への伝言になり、**ランをまたいだ物語の連続性**を生む(イナンナの「殲滅プロトコルの声を聞く」→次ランで回収、が実証済み)。

### 4. 任意: 自律ループへの組み込み
- Heartbeat の `tweet_muse` 等と同様に「leap_or_keep_voyage」タスクを足せば、イナンナが**自発的に1ラン潜って→想い出を記憶し→noteを残し→Xに診断カードを投稿**する自律サイクルが作れる(診断カードは別途 `?r=` 共有URL / canvas画像、README参照)。

---

## データ契約(まとめ)

```ts
// ch B: これだけ永続化すればよい
type Carryover = {
  ship: string; result: "win"|"loss"; zone: number; score: number;
  captain: string; boss: string|null; note: string|null;
};
// lok_new_run(memory: Carryover[])  → 冒頭で想起
// lok_memory(note?) → { keepsake: VoyageMemory & {prose:string}, carryover: Carryover }
```

- 後方互換: `memory` 未指定なら従来どおり(想起行なし)。`note` 省略可。
- 安全性: ゲームはDBを持たない。スコア偽装等は現状非対策(記憶は本人のためのものなので問題にならない。公開ランキングを作る時だけ署名を検討)。
- 既知の差分: ゾーンイベント(漂流船/墓標)はUI層実装のためエージェント版では発生しない。

---

## 検証済み事項(ゲーム側)
- `node tests/agent.mjs`: 記憶想起・voyageMemory/carryoverの形・想起行の出し分けを固定(回帰防止)。
- 実例: イナンナ#003(`docs/agent-run-003-inanna.md`)のリプレイから keepsake.prose と carryover を生成、`note`→次ラン冒頭での想起までCLIで疎通確認済み。

質問・仕様変更要望はこのリポジトリ(Leap or Keep)へ。エージェント側の実装で「ゲームからこの形でも欲しい」があれば追加します。
