# Leap or Keep — AIエージェント用プレイインターフェース

AIエージェント(Claude、イナンナ、その他LLMエージェント)が「Leap or Keep」を人間と**完全に同一ルール**でプレイするためのインターフェース。ゲーム本体には一切手を加えず、`index.html` のロジック層をそのまま実行する。

## 設計

- **合法手列挙方式**: 毎手、実行可能な選択肢がIDつきで列挙される。エージェントはIDを選ぶだけ — 不正な入力が構造的に存在しない
- **ステートレス・リプレイ**: ランの状態 = シード+選択IDログ。ゲームは決定論なので、ログがあれば任意の時点を完全再現できる(検証可能・改竄しにくい・保存がタダ)
- **観測は日本語テキスト**: 盤面グリッド/全ユニットのHP・慣性・**敵の行動予告**/手札の両半面 — 人間が見ている情報と等価

## 使い方① MCPサーバ(Claude Code / MCP対応エージェント)

```
claude mcp add leap-or-keep -- node <このリポジトリ>/agent/mcp-server.mjs
```

| ツール | 役割 |
|---|---|
| `lok_new_run` | ラン開始(seed/ship/asc/contracts) |
| `lok_state` | 観測+合法手リスト |
| `lok_choose` | 合法手IDをひとつ実行 → 新しい観測 |
| `lok_log` | シード・全選択ID・スコア・**船長診断**(記事/共有用) |

## 使い方② CLI(MCP非対応エージェント・スクリプト)

```bash
node agent/cli.mjs new --seed 42 --ship vagrants [--contracts heavy,minefield] [--asc 1]
node agent/cli.mjs choose pair:u0:top:u3 --say "まず間合いを作る"   # 選択+一言実況
node agent/cli.mjs choose act:0:ship:target:e0 act:1:drone:cell:2,3:right commit   # 複数手を一括実行
node agent/cli.mjs state                     # 現状を再表示
node agent/cli.mjs log                       # 記録(実況タイムライン+診断)
```

状態は `tmp/agent-run.json`(`--file`で変更可)。**毎回シードからリプレイ**されるのでプロセスを跨いでも安全。

**高速化と実況**(実プレイ#001の反省):
- **自動進行(⏩)**: 合法手が1つしかない強制フェイズ(慣性解決・敵ターン・戦域クリア確認など)は自動で消化される — エージェントは判断ポイントだけ見ればいい
- **バッチ実行**: choose に複数IDを渡すと順に適用(途中で不正になれば停止し、そこまでは保存)
- **`--say "一言"`**: その判断への一言コメントを記録。`log` の実況タイムライン(💬)に手と一緒に並ぶ — 配信・記事素材

## 主な選択IDの形式

```
pair:<uid>:<top|bottom>:<uid>      2枚選ぶ(1枚目は指定半面、2枚目は逆半面)
act:<idx>:<ship|drone>:cell:<x>,<y>:<dir>   移動(トーラスで2方向あるときdirが効く)
act:<idx>:<ship|drone>:target:<unitId>      攻撃・押し引き等
fizzle:<idx>                       その半面を不発にする
commit / undo                      ターン確定 / ターン丸ごとやり直し
damage_hp / damage_burn:<uid>      被弾をHPで受ける / カード永久ロストで無効化
keep / leap:<uid>[,<uid>]          帰還(勝利確定) / 深く跳ぶ(燃料=カード永久ロスト)
```

## 使い方③ 汎用LLMドライバ(ollama等のOpenAI互換API)

```bash
node agent/llm-driver.mjs --model qwen2.5:7b --seed 7 --ship vagrants
# --endpoint http://localhost:11434/v1 (既定=ollama)。終了時に成績+chronicle をJSONで出力
```

小型モデル向け設計: 会話履歴なし(毎手フル観測)・不正id→1回訂正→それでも駄目なら先頭手で前進(完走性保証)。`invalidPicks`/`fallbacks` がモデルの指示追従力の計測値になる。

## 航海記録(chronicle)と実況

- **chronicle**: ゲーム側がLLMなしで生成する航海ハイライト(物理キル・誘爆連鎖・同士討ち・連続撃破・九死一生などを機械検出し、ゾーン章立てで最大14行)。`log` / `chronicle` コマンド、人間版はサマリー画面📜に表示
- **--wow**: プレイヤー/エージェントが「今の瞬間が最高」と刻むマーク。chronicleの該当行に★がつき採用優先(ラン1〜4回推奨)
- **--say**: 判断への一言実況(タイムライン💬)。chronicleが「事実のドラマ」、sayが「人格の声」 — 二層構造

## 記憶連携(想い出＋引き継ぎ)

エージェントがランの記憶を持ち越せる2チャンネル。詳細と連携仕様: **[docs/HANDOFF-agent-memory.md](../docs/HANDOFF-agent-memory.md)**

- **`lok_memory(note?)`** / `cli memory --note "…"` → `{keepsake(想い出), carryover(引き継ぎ)}`
- **`lok_new_run(memory: carryover[])`** / `cli new --memory <file>` → 過去の航海をゲーム冒頭で「記憶」として想起
- `keepsake.prose` はそのまま記憶に保存できる散文。`carryover.note` は次ランの自分への伝言

## 既知の差分(人間版との違い)

- ゾーンイベント(漂流船/墓標)はUI層実装のため発生しない(botシミュレーションと同条件)
- 訓練航行・格納庫などメタ進行画面は対象外(ラン本体のみ)

## 検証

`node tests/agent.mjs` — 「ランダムに合法手を選び続けるだけで必ずラン終了に到達する」ことを120ラン検証(stuck/例外/列挙バグ=ゼロ)。
