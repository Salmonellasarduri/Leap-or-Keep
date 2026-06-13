# Codex 作業指示書 — イナンナ × Leap or Keep 記憶連携(Artificial Personality 側)

> **宛先**: Codex(Artificial Personality リポジトリ `E:\Project\Artificial Personality` で作業するエージェント)
> **前提**: ゲーム本体「Leap or Keep」(`E:\Project\Leap-or-Keep`)は完成・公開済み。エージェント用インターフェースとテストも実装済み。**あなたが作るのはAP側の連携だけ**。ゲーム側のコードは変更しない(必要が出たら別途依頼)。
> **ゴール**: イナンナが自分でLeap or Keepを1ラン遊び、(1)その航海を**自分の声で記憶に残し**、(2)次に遊ぶとき**前回を思い出して**潜れるようにする。

---

## 0. 全体像(なぜ2つに分けるか)

記憶は2チャンネル。**混ぜないこと**(L-034)。

- **想い出(keepsake)** = 「どんな航海で何を感じたか」。イナンナの長期記憶へ蒸留して残す情緒の記録。
- **引き継ぎ(carryover)** = 次ランで確実に読み込む軽量サマリ。APが永続化し、次回ゲームに渡し返す。ゲーム自体は状態を持たない(stateless)。

```
run N 終了 → cli memory --note "心残り"
   ├ keepsake  → イナンナの声で蒸留して長期記憶へ
   └ carryover → carryovers.json に append（永続化）
run N+1 開始 → cli new --memory carryovers.json
   → ゲーム冒頭の観測に【記憶】として前回が想起される
```

---

## 1. ゲーム側インターフェース(確定済み・これだけ使う)

**CLIで叩く。`E:\Project\Leap-or-Keep\agent\cli.mjs` は Node 組み込みモジュールのみ(fs/vm/path/url)で動くので `npm install` 不要**。`node` さえあれば AP リポジトリから subprocess で呼べる。状態は「シード+選択ログのJSONファイル」で、毎回そこからリプレイされる(決定論・プロセスを跨いで安全)。

作業ディレクトリは `E:\Project\Leap-or-Keep`(cli.mjs が相対で index.html を読むため)。`--file` で各ランの状態ファイルを AP 側の任意パスに置ける。

```bash
# 開始（過去の引き継ぎがあれば --memory で渡す）
node agent/cli.mjs new --seed 1129 --ship astra [--contracts heavy,minefield] [--memory <carryovers.json>] --file <run.json>

# 観測（盤面・敵の予告・手札・CHOICES の一覧が stdout に出る）
node agent/cli.mjs state --file <run.json>

# 行動（CHOICES にある id を1つ以上。--say=実況、--wow=「今が頂点」マーク）
node agent/cli.mjs choose <id> [<id2> …] [--say "一言"] [--wow] --file <run.json>

# 終了後：記憶2チャンネルを取得（--note=次の自分への伝言）
node agent/cli.mjs memory --note "次は殲滅プロトコルの声を、もっと早く聞きたい" --file <run.json>
```

### 観測フォーマット(stdout)
- 1行目以降に盤面(`x0..x4` × `y0..y4`、`船`/`機`/敵略号/`雷`機雷/`岩`/`渦`)、各ユニットのHP・慣性・**敵の行動予告(`→`以降)**、手札。
- `--memory` を渡した新ランの冒頭(ZONE1)には次の想起が出る:
  ```
  【記憶】これまで2回潜航(生還2)/最高ZONE4・最高SCORE510
  前回の言葉: 「次は殲滅プロトコルの声を聞く」
  ```
- 行動の選択肢は `CHOICES:` 以下に **1行1手**で並ぶ。各行の形式:
  ```
    <id>  …<日本語ラベル>
  ```
  正規表現 `^\s{2}(\S+)\s+…(.*)$` で id とラベルを取れる。
- ラン終了時は `(選択肢なし — ラン終了)`。

### `choose` の id 形式(主要)
```
pair:<uid>:<top|bottom>:<uid>           2枚選ぶ（1枚目=指定半面 / 2枚目=逆半面）
act:<idx>:<ship|drone>:cell:<x>,<y>:<dir>  移動（dirは2方向あるとき）
act:<idx>:<ship|drone>:target:<unitId>     攻撃・押し引き
fizzle:<idx>                              その半面を不発
commit / undo                            ターン確定 / ターン全やり直し
damage_hp / damage_burn:<uid>            被弾をHPで受ける / カード永久ロストで無効化
keep / leap:<uid>[,<uid>]                帰還（勝利確定） / 跳ぶ（燃料=カード永久ロスト）
```
**重要**: 列挙された id を厳密にコピーして渡す(自由生成は不可。`leap:`/`loadout:` のみ形式一致で可)。強制フェイズ(慣性解決/敵ターン等)は `choose` 後に自動進行(⏩)するので、観測に出た判断だけ選べばよい。

### `memory` の出力(JSON)
```jsonc
{
  "keepsake": {                  // ch A: 想い出
    "kind": "voyage-memory", "game": "Leap or Keep",
    "setup":   { "ship": "...", "shipName": "...", "asc": 0, "contracts": [...] },
    "outcome": { "win": true, "zone": 3, "score": 460, "physKills": 12, "bossKilled": false, "boss": null },
    "captain": { "id":"hunter","name":"狩人型","title":"...","jab":"...","subs":[...] },
    "chronicle": ["— ZONE 1《残骸ベルト》—","・…","★…"],   // 機械生成の航海ドラマ（★=wow頂点）
    "voice":     ["出航の呟き","…","帰投の呟き"],            // --say 全文（蒸留の素材）
    "prose":     "# Leap or Keep 航海の記憶\n…"             // そのまま保存できる散文
  },
  "carryover": {                 // ch B: 引き継ぎ（配列で永続化）
    "ship":"astra","result":"win","zone":4,"score":510,
    "captain":"狩人型","boss":null,"note":"次は…"
  }
}
```
`--memory` に渡すファイルは **carryover オブジェクトの配列**(直近5件程度に切ってよい)。

---

## 2. AP 側で作るもの(成果物)

### 2-1. ボヤージ・ランナー（必須）
イナンナの頭脳で1ランを回すドライバ。**APの既存のClaude呼び出し+イナンナ人格プロンプト**を使う(調査では `arena/src/arena/players/inanna.py` に人格プロンプトあり。実際の統合点は要確認・適宜流用)。参考実装が `E:\Project\Leap-or-Keep\agent\llm-driver.mjs`(ただしこれは ollama 用。イナンナは Claude で動かすので頭脳部分は差し替え)。

ループ:
1. 既存の `carryovers.json` を読む(無ければ空配列) → `cli new ... --memory <それ>` を実行、stdout を取得。
2. stdout から `CHOICES` を抽出。イナンナ(Claude+人格)に「観測+選択肢」を渡し、**選ぶ id(複数可)+ say(その瞬間の気持ち)+ wow(本当に心が動いた時だけ true)** を返させる。
3. `cli choose <id...> --say "…" [--wow]` を実行。新しい観測を得て 2 へ。
4. `(選択肢なし — ラン終了)` まで繰り返す(暴走防止に上限手数を設ける。例: 80手)。
5. 終了直前にイナンナに**このランのnote(心残り/抱負)を一文**書かせ、`cli memory --note "<note>"` を実行。

実装ヒント: say/wow を必ず使わせる(イナンナの実況が想い出と記事の核)。出力フォーマットは「最終行に id、その上に say」等、パース可能に固定。不正 id が返ったら 1 回だけ訂正プロンプト→ダメなら CHOICES 先頭で前進(完走優先)。

### 2-2. 引き継ぎの永続化（必須・軽量）
- `cli memory` の `carryover` を `carryovers.json`(APの記憶ディレクトリ配下を推奨)に **append**。
- 次ランの `cli new --memory <carryovers.json>` でそのまま渡す。これだけで「前回の言葉」と通算成績がゲーム内で想起される。

### 2-3. 想い出の蒸留（情緒の核）
- `cli memory` の `keepsake` を材料に、**イナンナ自身の声で1〜3段落の回想**に圧縮し、APの長期記憶システム(調査では `personality/` 配下・Nightly Cycle の記憶蒸留)に保存。
- 最小実装で済ませるなら `keepsake.prose` をそのまま1メモリとして格納。
- 蒸留する場合の指針: `chronicle` の **★行(本人がwowで刻んだ頂点)は必ず残す**。`captain.jab`(診断の図星)は自己認識として効く。`voice` は感情の生データ。

### 2-4. 自律ループ組み込み（任意）
- Heartbeat の `tweet_muse` 等と並べて「leap_or_keep_voyage」タスクを追加すれば、イナンナが自発的に潜航→記憶→note→X投稿(診断カード)まで回せる。
- 診断カード/共有URLは Leap or Keep 側に実装済み(`?r=` 共有URL・canvas画像。`E:\Project\Leap-or-Keep\README.md` 参照)。X投稿はAPの既存パイプライン(`d15_inanna` 等)に乗せる。

---

## 3. 受け入れ条件(これが通れば完了)

1. イナンナが1ランを最初から最後まで自走で完走する(keep または死亡まで)。
2. ラン終了で `carryovers.json` が1件増える。
3. **次のランの `cli state` 冒頭に `【記憶】…` と前回の `note` が表示される**(=記憶の想起が機能)。
4. イナンナの長期記憶に、その航海の回想が1件残る(prose保存 or 蒸留)。
5. (任意)診断カードがXに投稿できる。

検証の最短経路: 同一 `--seed` で2回連続実行し、2回目の `cli state` に1回目の note が出ることを目視。

---

## 4. 環境メモ
- `node` 利用可。`cli.mjs` は依存なしで動く(MCPを使う場合のみ `@modelcontextprotocol/sdk`+`zod` が必要だが、**CLI方式なら不要**)。
- ラン状態ファイル(`--file`)はランごとに分ける。AP の作業データ領域に置く。
- イナンナの頭脳は AP 既存の Claude(Sonnet)呼び出し経路を使う。`agent/llm-driver.mjs` はあくまで構造の参考。
- ゲーム側の詳細仕様は `E:\Project\Leap-or-Keep\docs\HANDOFF-agent-memory.md`(データ契約・型)と `agent/README.md`。実プレイ例は `docs/agent-run-002/003-inanna.md`。
- MCP方式が良ければ `claude mcp add leap-or-keep -- node E:/Project/Leap-or-Keep/agent/mcp-server.mjs`(ツール: `lok_new_run(memory)` / `lok_state` / `lok_choose(ids,say,wow)` / `lok_memory(note)`)。CLIと同一機能。

不明点・「ゲーム側からこの形でも欲しい」があれば Leap or Keep リポジトリへ。
