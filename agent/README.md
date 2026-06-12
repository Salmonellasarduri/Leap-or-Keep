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
node agent/cli.mjs choose pair:u0:top:u3     # CHOICESから選ぶ
node agent/cli.mjs state                     # 現状を再表示
node agent/cli.mjs log                       # 終了後の記録(診断含む)
```

状態は `tmp/agent-run.json`(`--file`で変更可)。**毎回シードからリプレイ**されるのでプロセスを跨いでも安全。

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

## 既知の差分(人間版との違い)

- ゾーンイベント(漂流船/墓標)はUI層実装のため発生しない(botシミュレーションと同条件)
- 訓練航行・格納庫などメタ進行画面は対象外(ラン本体のみ)

## 検証

`node tests/agent.mjs` — 「ランダムに合法手を選び続けるだけで必ずラン終了に到達する」ことを120ラン検証(stuck/例外/列挙バグ=ゼロ)。
