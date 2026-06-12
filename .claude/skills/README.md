# Skills — migrated from "Artificial Personality"

2026-06-10、`E:\Project\Artificial Personality` の `.agents\skills`(Codex用)と `.claude\skills`(Claude用)から、Fable による自律型開発に有用なものを選別して移植。

## 移植したもの

| Skill | 移植元 | 適応内容 |
|---|---|---|
| `ui-ux-pro-max` | `.claude/skills`(Claude版をそのままコピー) | なし(67スタイル・96パレット・57フォントペア等のデータ含む。本ゲームのUI設計に使用) |
| `anti-human-bottleneck` | `.claude/skills/nyosegawa-anti-human-bottleneck` | INANNA固有のワークフローゲート(/design /save等)を削除し、本プロジェクト用の例外(仕様レベルの設計判断・破壊的操作のみ人間に確認)に置換 |
| `autonomous-milestone-runner` | `.agents/skills`(Codex版のみ存在) | Codex→Fable 適応: L1-L4ディスパッチをAgent/Workflowツールに置換、INANNA固有ゲート・behavior-validate参照を削除 |
| `ux-comm` | `.claude/skills/ux-comm` | INANNAボット固有の例(config.yaml、botの再起動)をブラウザゲーム文脈(リロード、localStorage)に置換 |
| `qa-lenses` | `.agents/commands/_shared.md` から抽出 | QAアーティファクトチェーン・ブラックボックスQAレンズ・オラクル規律・複雑度バジェットをスキル化。例をこのゲームの題材に置換 |
| `/debugging`(コマンド) | `.agents/commands/debugging.md` | 2026-06-11追加。INANNA live-check をブラウザゲーム検証(Preview/Chrome MCP)に置換、L1-L4→Fableエージェントに置換 |
| `/save`(コマンド) | `.agents/commands/save.md` | 2026-06-11追加。inanna-skill-validate除去、未初期化リポジトリ対応(初回saveでgit init)、codex/*ブランチ規約を除去 |

## プロジェクト内で生成したスキル

- `game-design-essence` — 西村裕『ルールデザインノート』(オーナー提供PDF)のエッセンスを汎用化(2026-06-11)。非線形性≒ゲーム性/多脚構造/順序選好ループ/勝利モジュール4類型/ジレンマ監査チェックリスト。**他プロジェクトへコピー可能な自己完結スキル**
- `qa-lenses` `anti-human-bottleneck` 等は下記マイグレーション由来

## 外部由来スキルの出典・ライセンス（再配布時の帰属）

このリポジトリを public 化する場合、以下は外部由来のため著作権表示の保持が必要（各 SKILL.md の metadata にも記載済）。

| Skill | 作者 | 出典 | ライセンス |
|---|---|---|---|
| `anti-human-bottleneck` | 逆瀬川ちゃん (@gyakuse) | https://github.com/nyosegawa/skills / https://nyosegawa.com/posts/claude-code-verify-command/ | MIT |
| `ui-ux-pro-max` | Next Level Builder | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT (Copyright (c) 2024 Next Level Builder) |
| `qa-lenses` | 自家製（発想元: ゲノムちゃん/RNA4219 氏の記事） | 発想元: https://zenn.dev/rna4219/articles/0c51e22473e3c8 （manual-bb-test-harness の解説記事）。AP `.agents/commands/_shared.md` で独自に書き起こした節を抽出。内容は JSTQB 系の公知テスト技法ベースで、RNA4219 の3リポジトリと照合済＝逐語コピーではない | 自家製（公知技法ベース、着想クレジット記載） |

> ~~public 化前 TODO: MIT 2件は LICENSE 全文の同梱が必須要件~~ → **2026-06-13 対応済**: リポジトリ直下 `THIRD_PARTY_LICENSES.md` に両 MIT 全文（Copyright (c) 2026 Sakasegawa / Copyright (c) 2024 Next Level Builder、gh api で原文取得）を同梱。repo は v0.9 で既に public のため、このファイルのコミットを最優先で。

## スキップしたもの(理由)

- **コマンド群のうち /design /strategy /strategy_deep /reviewing /implement**: Fableのプランモード・組み込み /code-review・通常の実装フローで代替できるためスキップ(2026-06-11判断)。ゴール契約の考え方自体は autonomous-milestone-runner と qa-lenses に吸収済み

- **INANNA固有**: behavior-validate, inanna-skill-validate, inanna-sprite-action-gif, enqueue-book, skill-promote, sync-cewk, docs-map, doc-updater, lesson-record(同プロジェクトのdoc構造・lessons.md分類に密結合)
- **Codex CLI / 外部CLI固有**: agent-dispatch, codex-analyst, gemini-researcher, plan-researcher(Fableは組み込みのAgent/Workflowツールで代替)、memory-curate(FableはネイティブのMemoryシステムを持つ)、empirical-prompt-tuning(Codex命令チューニング用)
- **無関係**: create-note-header, recording-visual-qa(OBS録画検証), python-patterns(本ゲームはJS), remind, anthropics-skills-*(Fableに組み込み済み or 用途外)
