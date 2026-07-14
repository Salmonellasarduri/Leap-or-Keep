---
name: lesson-record
description: "Use this skill when recording a new lesson in tasks/lessons.md, adding a recurrence note to an existing lesson, or judging whether a lesson should graduate into a machine guard. Defines Leap-or-Keep's compact bullet format, domain tags, duplication judgment, and the four graduation paths (lint-guards static check / sim+agent invariant test / runtime gate / archive)."
metadata:
  version: 1.0.0
  origin: "Artificial Personality/.claude/skills/lesson-record — Leap-or-Keep の lessons.md 形式・実ツールへ適応移植(2026-07-14)。当初 migration では『doc構造に密結合』としてスキップされていたもの。"
---

# lesson-record — レッスン記録・卒業判定(Leap or Keep 版)

> `tasks/lessons.md` への記録・同根判定・**機械ガードへの卒業**を定義する。
> 中核思想: 散文の教訓は従われない。静的/実行時に検知できる罠はコードのガードへ卒業させ、毎コミット自動実行する。

---

## 記録フォーマット(既存 L-001〜 と揃える)

lessons.md は1レッスン=1行のコンパクト箇条書き。grep 安定性のため次を守る:

```
- **L-XXX** [tag][tag] **見出し(太字)**: 状況と根本原因 → 対策。→ 卒業先: <ガード名 or なし>
```

- `- **L-` + 3桁で識別。番号は連番(現在 L-043 まで)。
- タグは本作のドメイン語彙を使う: `[rules] [balance] [design] [ux] [visual] [i18n] [qa] [tooling] [process] [agent] [market] [torus] [juice]`。2つ以上該当なら予防に直結する側を先頭に。
- **末尾に必ず `→ 卒業先:`** を書く。静的検知できるなら機械ガード名、runtime依存や運用知なら「なし(理由)」。
- 再発時は本文に `(再発 YYYY-MM-DD: 今回の事象)` を追記。行は増やさない。

---

## 同根判定(dedup)— 記録の前に必ず

同系タグの既存レッスンの根本原因を読み比べ、次で判定する:

1. **新規** — 同タグに該当なし、または見落としメカニズムが別 → 新 L-XXX を追加
2. **既存に再発追記** — 同タグ・同じ見落とし方 → 既存行に `(再発 …)` を追記
3. **重複(記録不要)** — 既存ルールが完全に網羅 → 追加しない。コミットメッセージに `既出: L-XXX` を1行残す
4. **判定不能** — 境界がagentで割れない → 候補L-XXXを提示してオーナーに委譲

迷ったら別エントリ(誤統合より誤分離が安全)。ただし「迷う」が常態化したら 4 のオーナー委譲。

## 記録時の Red flags(合理化への警戒)

| 出てくる合理化 | 実態 |
|---|---|
| 「プロジェクト固有だけど念のため」 | コミットメッセージで済むなら記録しない。lessons.md を薄める |
| 「静的検知できるが散文の方が早い」 | 静的検知可能なら **lint-guards への卒業が第一候補**。プロンプト記載は従われない |
| 「失敗を省いて解決策だけ書く」 | 何を見落としたかを書かないと未来の自分が同じ穴に落ちる |
| 「記録のために薄い教訓を書く」 | ゼロ件記録も正解。空の振り返りに害はない |

---

## 卒業パス(4種)— これが「二度と踏まない仕組み」の本体

### 1. `tools/lint-guards.mjs` の静的ガード(第一候補)

**条件**: ソースの文字列パターンで機械検知できる(禁止識別子・禁止API・命名規約)。
**手順**: `tools/lint-guards.mjs` にチェックを1つ追加(実行番で位置を報告し exit 1)→ near-miss を含む簡易自己テストで誤検知/見逃しを固定 → lessons 行の `卒業先` にガード名を記載。
**例**: L-037(LOGIC区間の純度)/ L-038(EN_RULES.unshift 強制)。

### 2. `tests/sim.mjs` / `tests/agent.mjs` の不変条件テスト

**条件**: 挙動・仕様の不変条件として表現できる(ルール違反ゼロ・列挙の網羅・数値の整数性)。
**手順**: 該当テストに `ok(...)` 不変条件を追加(L-XXX をコメントに)→ lessons の `卒業先` にテスト名。
**例**: L-020(全カード×全アクションのスモーク)/ L-042(protocol 合法手列挙の同条件化)。

### 3. runtime ゲート

**条件**: 実行時にしか測れない(投影整合・フレームタイム・単位系)。
**手順**: 既存ゲート(`window.__holo.calibCheck()` ≤2.5px / `tools/fps.mjs`)に判定を寄せる。切り分けが要るなら自動再計測など機構側で吸収 → `卒業先` にゲート名。
**例**: L-039(holo3再キャリブ→calibCheck)/ L-041(fps偽FAIL→自動再計測)。

### 4. アーカイブ(構造解消)

**条件**: コード構造の変更で再発が構造的に不可能になった。
**手順**: lessons 行に `(構造解消: コミット/テスト名)` を付す。番号は欠番にせず残す(L-018 のように順不同でも保持)。

---

## 棚卸し

- アクティブレッスンの目安上限 **なし**(本作は開発ログ性格が強く歴史的価値で保持)。ただし卒業先が「なし」のまま再発したものは機械化を再検討。
- 卒業先を持つレッスンが再発したら、まずガードが機能しているか(実行されているか)を疑う — ガードの穴を塞ぐのが正しい対処。
- 新カテゴリのタグが3件溜まったら README 記載のタグ表を更新。
