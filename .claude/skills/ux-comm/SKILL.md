---
name: ux-comm
description: "Use this skill BEFORE reporting a completed code change to the user, proposing a new phase, or giving multi-step instructions. Defines three UX communication rules: every change report must include timing semantics (immediate / reload-required / restart-required), every acronym/phase-name must be expanded on first mention with a plain-language summary, and multi-step procedures must be delivered as copy-pasteable commands with full paths."
metadata:
  version: 1.1.0
  origin: "Artificial Personality .claude/skills/ux-comm, genericized for Leap-or-Keep"
---

# ux-comm — UX コミュニケーション規約

> オーナーへの伝達品質を守る対話規約。

---

### 1. 変更報告には必ず「反映タイミング」を添える
**コード変更を伝えるときは末尾に反映条件を明示する。**
- Why: ユーザーには「いま開いている画面に効いているのか」が不明で混乱する
- ケース別の定型文(ブラウザゲーム想定):
  - 即時: 「ページをリロードすると有効になります(ブラウザで F5)」
  - サーバー再起動必要: 「ローカルサーバーを再起動すると有効になります(コマンド付きで提示)」
  - 進行データ影響: 「localStorage のセーブデータに影響します。リセットが必要な場合はその手順も提示」

### 2. 略称は初出で展開し、平易な説明を先に
**新フェーズ・戦略を提案するときは必ず「一言で〜」の説明を添え、技術詳細の前に「何が変わるか」を平易な言葉で示す。**
- Why: フェーズ名・略称だけではオーナーに伝わらない
- フォーマット: `フェーズ名: **一言で**(具体的に何が変わるか)→ 技術詳細`

### 3. 複数工程の手順はコピペ可能な形で全工程提示
**変更の反映に複数工程が必要な場合、全工程をコピペ可能なコマンド付きで案内する。**
- Why: 開発者にとって自明な手順(ビルド、サーバー起動、リロード)もユーザーには順序・コマンド・パスが不明
- 「〜してください」ではなく「以下を実行してください:(コマンド)」の形式、パスは省略せずフル
