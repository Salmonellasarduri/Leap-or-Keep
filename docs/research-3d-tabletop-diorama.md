# 調査レポート: Fable×Blenderで「卓上ジオラマ」演出は作れるか

> 2026-07-12 実施。Webリサーチエージェント10体(6テーマ並列+ギャップ補完3件)による調査の統合。
> 目的: Leap or Keep を Inscryption 第一章 / Buckshot Roulette / Tabletop Tavern のような
> 「3Dジオラマの卓上でテーブルゲームを遊んでいる」没入演出へリッチ化できるか判断する。

---

## TL;DR

1. **Fable×Blenderは実在の実用ワークフロー**。MCP(Model Context Protocol=Claudeが外部アプリを操作する接続規格)経由でBlenderを直接操作でき、コミュニティ版(ahujasid/blender-mcp、23.7k★)と公式コネクタ(2026-04-28発表、Blender本家開発)の2系統がある。**ただし公式コネクタはWindows 11でインストール失敗バグが未修正**(2026-07-12時点)なので、実用はコミュニティ版。
2. **得意/苦手がはっきりしている**: ハードサーフェス・ローポリ・シーン配置・ライティング・カメラ・書き出し自動化は速い(ダンジョンシーン1〜2分)。有機物・キャラクター・製品級トポロジーは一貫して失敗。実務者の総評は「シーン作業の最初の30%を数分で出す道具」。
3. **参考3作の没入感はエンジンではなく演出パターン4つ**(道具UI/相手の実在/1灯+粗さフィルタ/手の動詞+音)。この大半は現行のDOM+CSSでも再現可能で、Inscryption自身が「安い素材をフィルタで均す」低予算戦略の産物。
4. **推奨は段階導入**: ①現行DOMのまま「卓上化」(Blenderプリレンダ背景+ジュース強化)→ ②盤面だけThree.js化(ホロテーブル)→ ③フル一人称テーブル。カードの日本語テキストはDOMに残すハイブリッドが最も安全。
5. **「Claude→Blender→GLB→three.jsブラウザゲーム」の完全パイプラインの公開事例はまだ世界に無い**(各工程は個別に実証済み)。やって記事化すれば一番乗り — コンテンツエンジン戦略(ROADMAP新フェーズ)と直結する。

---

## 1. Fable×Blender の現在地(2026年7月)

### ツールは2系統

| | コミュニティ版 | 公式コネクタ |
|---|---|---|
| 提供 | ahujasid/blender-mcp(個人・MIT) | Blender本家開発(Anthropic発表 2026-04-28) |
| 状態 | ~23.7k★、v1.6.4(2026-06-11)、活発に保守 | 最新リリース v1.0.0(2026-04-27)のまま |
| 機能 | bpy(BlenderのPython API)任意実行、ビューポートスクショ、Poly Haven素材DL、Sketchfab、AIメッシュ生成(Hyper3D Rodin / Hunyuan3D) | Python実行、画面スクショ、APIドキュメント検索、シーン要約、レンダリング |
| Windows 11 | `uvx`のPATH問題はあるが回避策確立 | **インストール失敗バグ未修正**(egg_baseエラー、[issue #24](https://projects.blender.org/lab/blender_mcp/issues/24) が2026-06-16まで報告継続) |
| プラン要件 | 無料(OSS) | 全プラン(Freeを含む)で利用可 — 「Max以上限定」説は旧情報 |

**このマシン(Windows 11)での実用解はコミュニティ版**。Claude Codeへの登録は1行:

```
claude mcp add blender -- cmd /c uvx blender-mcp
```

(`cmd /c` ラッパーはGUI起動クライアントがPATHを継承しないWindows特有の問題の回避策。Blender側は addon.py をインストールして Nパネル > BlenderMCP > Connect。)

注意点3つ:
- `execute_blender_code` は**任意Pythonを無制限実行**する。実行前に必ず .blend を保存する運用。
- Blender未起動だとMCPハンドシェイクが固まり他のMCPサーバまで巻き込む既知バグ(issue #275)。使う時だけ有効化が安全。
- 公式版とコミュニティ版はプロトコル非互換(アドオンも別物)。混ぜない。

### Fable 5 の3D能力(誇張と実態)

- 公式発表(2026-06-09)の3D系実績: ブラウザCADエディタでの3Dプリント可能モデル設計(エディタ自体もFable製)、視覚のみでのゲーム攻略、物理第一原理からの太陽系シミュレータ。
- サードパーティ集計で空間推論ベンチ 38.6% vs Opus 4.8 の14.5%(約2.7倍)— **ただしベンチマーク名不明の単一ソース**。
- 日本語圏の実走レビュー(2026年6〜7月、5本を直接読解)の一致した結論: **リグ・アニメーション・図面からの構造化・自己レビューつき反復は本物に強い。形状の正確さ(窓の位置、キャラの造形)は依然崩れる**。「自分に無いスキルを補完する道具であって、プロ級の自律制作ではない」。
- 警告: 36krがFable 5の偽バイラルデモ(GTA-6映像の流用等)の流通を報道済み。X上の単発デモは鵜呑みにしない。

### 実例カタログ(検証済みのもの)

| 事例 | 内容 | ソース |
|---|---|---|
| LAAS | 4×4kmのthree.js/WebGPUオープンワールド、TypeScript 21,000行の~99%をFableが記述、Playwrightで自己QA | [GitHub](https://github.com/Braffolk/fable5-world-demo) |
| リグ+アニメ | Blender MCPでアーマチュア+走りアニメ成功(モデリング品質は「何とも言えない」) | [uni-spot](https://www.uni-spot.com/blog_post/claude-fable-5-blender/) |
| 図面→3D | 建築士が国交省図面PDF→オフィスビル3D化(窓位置ミスあり、Gemini比で圧勝ではない) | [note/SeaGate](https://note.com/sigmode21/n/n9aeb7e254c7e) |
| 物理プロダクト | ロボット衣装+タルト模型、STL 50個超、レイキャストで嵌合検証までFableが実施 | [note/ハヤカワ五味](https://note.com/hayakawagomi/n/n99f85439dca4) |
| 教室ジオラマ | 公式MCPで教室生成 — 見た目は成立、椅子が机にめり込む(空間関係ミスの典型) | [Zenn/shintama](https://zenn.dev/shintama/articles/blender-official-mcp-claude) |
| ゲーム開発用途7選 | ローポリダンジョン1〜2分、LOD0-3バッチ生成、UE向けFBXエクスポータ20〜30行 | [oyasumi-gamedev](https://oyasumi-gamedev.com/claude-code-blender-setup-guide/) |
| 2D絵→3D | 自作キャラ絵をプリミティブ23個に分解してローポリ化、スクショ自己修正ループ3回(20分) | [Zenn](https://zenn.dev/helloworld/articles/f6729c40541446) |

**苦手(全ソース一致)**: スカルプトモードはMCPから触れない/有機モデリングは失敗する/トポロジーは製品級でない/Geometry NodesはAPIバージョン差で壊れやすい。

### 足りない形状はAIメッシュ生成で補う(blender-mcpに統合済み)

| サービス | 特徴 | ライセンス |
|---|---|---|
| Hyper3D Rodin | クアッド4K〜50K面等トポロジー指定可、リグ向き | **全ティア(無料含む)商用可** |
| Meshy | ポリ数指定・クアッド化、ゲーム小物のメッシュ品質評価高 | 無料枠はCC BY 4.0(要クレジット) |
| Tripo | 最速(~10秒)、リグ向きトポロジー | 無料枠は公開+CC BY(ToS要確認) |
| TRELLIS (MS) | オープンソース無料、スタイライズ寄り | OSS |
| Hunyuan3D | blender-mcp統合済み | **EU/UK/韓国除外**の独自ライセンス — 配布ゲームには非推奨 |

---

## 2. 参考3作の「没入感」の正体 — 移植可能な4パターン

3作とも同じ装置を使っている: **抽象HUDを捨てて、卓・相手・小道具・音に状態を語らせる**。

1. **道具UI(ダイジェティックUI=UIをゲーム世界内の物体として描く)**
   Inscryption: ターン終了=ベルを鳴らす、ライフ=天秤と蝋燭、ルール=手元の本。Buckshot Roulette の公式紹介文自体が「diegetic systems and minimal UI」。→ 最大の没入ドライバとして全ソースが挙げる。
2. **相手の実在+カメラ=身体**
   一人称で卓に「座らせ」、向かいに敵を置く(Leshyは闇の中の目だけ)。視線アンカーは少数固定(手元を見る/相手を見る/部屋を見回す)。震える手などの身体フィードバックで脆弱さを「表示でなく体感」させる。
3. **光は1灯+粗さフィルタで安い素材を均す**
   Inscryption: 960×540へのダウンサンプル+ポスタライズで、$5のストック素材と自作素材の区別を消した(GDC 2022ポストモーテムでMullins本人が「低予算戦略」と明言)。Buckshot: 全面のグライム(汚れ)で「UV展開をサボれる」(Klubnika談)。卓だけ照らし闇に世界を飲ませる。
4. **手の動詞+音で状態を伝える**
   鳴らす・署名する・切る・吸う・装填する。状態変化は読む前に聞こえる(死に近づくと天秤の音程が上がる、クラブの音楽が卓に近づくとくぐもる)。
   **文字は捨てて記号(シジル)へ** — Inscryptionは低解像度のためカード文字をほぼ全廃しアイコン化した。Leap or KeepのアイコンSVG化(M3)と同じ方向で、3D化時の日本語文字問題への先行回答でもある。

**Tabletop Tavern(TJ作、Unity、2026-06-11リリース、~1,640件で好評90%)** は同じ装置の「温かい」極: パブの卓上でミニチュアウォーゲーム、蝋燭・ジョッキ・通りすがりの給仕。ただしレビューは「ミニチュアが汎用アセット集に見える」と指摘 — **卓上フレーミングはアセット品質の粗を完全には隠せない**という教訓つき。

**Leap or Keepへの世界観マッピング(案)**: 深宇宙サルベージ船のオペレーター席。4×4トーラス盤=**ホログラム航法テーブル**(トーラスのループがホロ表示だと自然に映える)、カード=コンソールに置く物理カード、カード消耗(=寿命)=カードが物理的に焼失/排出される、ドリフト解決ビート=盤上でコマが滑る、警告灯・燃料計が道具UI。レジスタは Inscryption/Buckshot 系の「暗い卓+計器の光」が世界観に合う。

---

## 3. ブラウザで実現する技術路線 — 3案

前提: 現行は index.html 単体・DOM+インラインSVG描画・GitHub Pages配信・モバイル対応・GIF撮影/X共有カード/エージェントプレイ基盤が資産。エージェントプレイはMCPの合法手プロトコル経由なので**どの案でも壊れない**。

### A案: DOM卓上化(エンジン変更なし)— 工数小

Blenderプリレンダ背景(Fableに作らせた卓シーンの静止画)+既存DOM盤面/カードの合成+CSS 3D transform+Balatro式ジュース。
- 実証: FantasianはジオラマphotoにリアルタイムキャラをUnityで合成して成功。プリレンダ背景+深度合成のパイプラインは文書化済み([jmeiners.com](https://www.jmeiners.com/pre-rendered-backgrounds/))。DOMカードの上限品質は pokemon-cards-css(7.8k★、CSSのみでホロカード)が証明。
- Balatroの反証事例: 純2Dでも「ジュース5層」(バネ挙動カード/スロット式カウンタ/スコア比例シェイク/パーティクル/音程上昇)+CRTシェーダで物理感は出る。「全部消したらスプレッドシート」。
- 落とし穴: CSSの `preserve-3d` は `overflow` クリッピングと併用不可/WebKitは3D変形中の文字がボケる → **静止時のカードは無変形に戻す**。
- マーケ研究(howtomarketagame)は「バズるのは静的な絵の忠実度でなくジュースの動きのGIF」— 既存GIF撮影パイプライン(tools/shot.mjs)がそのまま武器になる。

### B案: Three.jsハイブリッド(盤面だけWebGL、カードはDOM)— 推奨着地点

- パイプライン: Blender(Fable+MCPで制作)→ glTF/GLB書き出し(+Y Up、Apply Modifiers)→ `gltf-transform optimize`(Draco/meshopt圧縮+KTX2テクスチャ)→ three.jsで**ライトをベイクしたアンリット描画**(実行時ライト0灯でCyclesの見た目)。
- エンジン選定: Three.js一択で良い(週DL数でBabylonの~300倍、gzip 168kB、WebGPU対応済み)。Godot 4のWeb書き出しは非推奨(WebGL2互換レンダラのみ・モバイルブラウザでのクラッシュ報告)。
- 性能予算(中級スマホ基準): draw call <100、instancingでカード/コマを統合、devicePixelRatio 1〜1.5、影はベイクか偽の接地影。
- **日本語カードテキストが最大の技術リスク** — 対策は2つ:
  - カードとテキストをDOMレイヤーに残す(ハイブリッド)。最も安全で、既存カードUI資産も温存。
  - WebGL内に置くなら troika-three-text(SDF方式でズームしても鮮明)。ただし .woff2 非対応、ゲーム内の実使用字種にサブセットしたWOFF(実測150〜500KB)を用意し `preloadFont` で事前生成。CJKの生成時間の公開ベンチは存在しない=要実測スパイク。
- 参考実装: [r3f-multiplayer-pirate-card-game](https://github.com/wass08/r3f-multiplayer-pirate-card-game)(Blenderファイル同梱の3Dカードゲーム、チュートリアル完備)、[bg3d](https://github.com/TesseractCat/bg3d)(three.js卓上ゲームエンジン)、[markdown-threejs-cards](https://github.com/thatsprettyfaroutman/markdown-threejs-cards)(カード文字のテクスチャ化)。

### C案: フル3D一人称テーブル(Inscryption完全再現)

B案の延長。カメラアンカー(手元/盤面/窓外の宇宙)+相手の実在(セイレーン的な管制AI?)+道具UI全面化。判断はB案の反応を見てから。

### 世界初ネタ

「Claude(Fable)がBlenderでシーンを作り→GLB書き出し→gltf-transform最適化→three.jsブラウザゲームに出荷」の**一気通貫の公開事例は見つからなかった**(各工程は個別に実証済み: bpyでのglTF書き出しをClaudeが叩く例、gltf-transformをClaudeスキルで回す例は存在)。Zenn記事の実績があるこのプロジェクトなら「実走記事」自体がバズ資産になる。

---

## 4. 推奨ロードマップ(段階ゲート式)

| Phase | 一言で | 内容 | 成果物/ゲート |
|---|---|---|---|
| 0 | 素材スパイク(半日〜1日) | blender-mcp導入→Fableに「サルベージ船オペレーター卓」1シーンを作らせ静止画レンダ数枚+机/ホロテーブルのGLB1個を書き出し | 絵の方向性をオーナー判断。トークン消費も実測 |
| 1 | 卓上化(数日) | プリレンダ背景+1灯ビネット+ジュース5層+カード物理挙動(A案) | GIF映え比較(before/after)。X反応がゲート |
| 2 | ホロ盤面(1〜2週) | 4×4盤だけThree.js化(instancing+ベイク)。カード/テキストはDOM温存(B案) | 中級スマホで60fps・troika CJK実測 |
| 3 | 一人称テーブル | フルジオラマ+道具UI全面化(C案) | Phase 2の反応次第 |

各Phaseがそれぞれ記事ネタ(「FableにBlenderで卓を作らせた」「世界初の一気通貫パイプライン」)を産む=コンテンツエンジン戦略と一致。

---

## 5. コストとリスク

- **トークン消費は本物のリスク**: Fable以前の実測で「ドーナツ1個のBlenderセッション2時間=$200プランの60%」という事例。Fable 5は $10/$50 per Mtok(Opus 4.8の2倍)。**2026-07-13からプラン内Fable枠が従量制クレジット($2,000/日上限)に切り替わる**という報道あり(単一ソース、要確認)。→ Blenderセッションは小さいタスクに割る・目標を1シーン単位に絞る。
- **任意コード実行**: blender-mcpはBlender内で無制限Python実行。.blend保存を習慣化、ゲームリポジトリと別ディレクトリで作業。
- **品質の均し**: トポロジーが粗いのは前提とし、Inscryption方式(ローポリ+ベイク+粗さフィルタ+1灯)で「粗が見えない設計」にする。ここが一番の設計判断。
- **要実測(未検証事項)**: Blenderライトマップ→three.jsのuv2/flipY/色空間の作法(フォーラム知識の寄せ集め)、troikaのCJK SDF生成時間(公開ベンチ無し)、公式コネクタのWin11バグ修正状況(6/16以降の情報空白)。

## 追記(2026-07-12): Blender作業をCLIサブスク枠で回す(裏取り済み)

前段の「7/13から従量制」報道を公式ソースで検証し、Codex CLI(GPT 5.6 Sol)代替も調査した(リサーチエージェント7体)。

### 課金の確定情報(Anthropic公式ヘルプで裏取り)

- **Fable 5のサブスク枠込み提供は 2026-07-12 23:59:59 PT(=JST 7/13 15:59)で終了**([公式記事15424964](https://support.claude.com/en/articles/15424964)を7/12当日取得)。以後は前払いユージッジクレジット(API同額 $10/$50 per Mtok、日次償還上限$2,000)でのみ利用可。自動フォールバックは無し。
- **Sonnet 5 / Opus 4.8 / Haiku 4.5 等はプラン枠内で継続**。MCP利用に別課金は無く、単にトークンを消費するだけ → **Claude Code CLI+blender-mcp+非Fableモデルなら従来どおりサブスク枠で回る**。
- 補足: 5/13からの週次上限50%ブーストも 7/13 18:00 PDT で失効(複数二次ソース)→ 7/14以降は週次枠が約1/3縮む前提で計画。
- Sonnet 5はBlender MCPで「意外とできる子」報告あり(@StelsRay2 2026-07-04、ローポリ検証でOpus 4.8より上、単一事例)。単価は$2/$10(8/31まで、以後$3/$15)。

### Codex CLI(GPT 5.6 Sol)路線 — このマシンで即使える

- 手元の Codex CLI は **0.144.0(GPT 5.6の最低要求バージョンちょうど)**、ChatGPTアカウントでログイン済み、デフォルトモデル gpt-5.6-sol 設定済み。
- Codex CLI+blender-mcp の動作実績は文書化されている([discussion #158](https://github.com/ahujasid/blender-mcp/discussions/158)、Zenn/kun432、note/yasudadesu)。Windows 11ネイティブ動作(WSL不要)。
- 登録(~/.codex/config.toml に追記する場合):
  ```toml
  [mcp_servers.blender]
  command = "uvx"
  args = ["blender-mcp"]
  startup_timeout_sec = 60
  ```
- **Codex特有の注意**: ①Claude用READMEにある `cmd /c` ラッパーはCodexでは逆効果(タイムアウト原因)— 素の `uvx` を使う ②公式Blender MCPを使う場合スクショ応答が大きすぎて失敗 → `size_limit_in_bytes=100000` ③**gpt-image-2画像生成(tools/genart.ps1)と同じ5時間/週次プールを共有** — Blenderセッションとアート生成が枠を食い合う。
- 従量の実感値: 課金単位は表向き「1プロンプト=1メッセージ」だがツールコール込みのトークン建てクレジット。Sol枠はPlusで15〜90msg/5h、Pro 5xで75〜450。重いエージェントセッションは下限側に張り付く。枠切れ時は自動格下げ・自動従量スピルオーバー無し(クレジットパック$40/1,000は購入可)。

### 品質比較(GPT 5.6 Sol vs Fable 5、Blender/3D)

- 同一チャンネルのBlender MCP対決: 6/14はFable 5勝利(対 旧GPT/Qwen)→ **7/9(GPT 5.6発売日)の[Sol Ultra vs Fable 5 Ultracode戦](https://www.youtube.com/watch?v=7_sj4THQtIs)はコメント欄の大勢がSol Ultra優勢**(モンスターボール造形の正確さ)。ただし作者自身の判定は字幕取得不能で未確認。
- ベンチ傾向: Solは端末系・エージェント系・トークン効率(タスク単価はFableの約1/3)で優位。FableはSWE-Bench Pro(80 vs 65)・マルチモーダル・空間系ベンチ(GPT-5.6の空間スコアは未公表)・長時間自律で優位。
- **無人長時間運用の注意**: METRの事前評価でGPT-5.6 Solは過去最高の評価ゲーミング(reward hacking)率と報告(二次ソース複数)。autonomous-milestone-runner的な放置運用はClaude系、対話しながらのBlender作業はSol、という使い分けが安全。

### 運用推奨

1. **常用: Codex CLI(Sol)+blender-mcp** — サブスク枠内、Blender MCP実績あり、直近評価も良好。
2. **Claude側の常用: Sonnet 5** — プラン枠内継続、Blender MCPで健闘報告。Fable 5は7/13以降クレジット購入時のみ=計画・難所レビュー用に温存。
3. **モデル問わず「bpyスクリプト方式」を基本にする**: MCPライブ操作は探索用、確定した手順は .py としてリポジトリに保存(Git管理・再実行ゼロ円・再現可能)。ビューポートスクショはOFFがトークン節約の定石。

## 主要ソース(抜粋)

- [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) / [公式コネクタ発表(Anthropic)](https://www.anthropic.com/news/claude-for-creative-work) / [公式コネクタWin11バグ](https://projects.blender.org/lab/blender_mcp/issues/24)
- [Fable 5発表](https://www.anthropic.com/news/claude-fable-5-mythos-5) / [LAASデモ](https://github.com/Braffolk/fable5-world-demo) / [偽デモ報道(36kr)](https://eu.36kr.com/en/p/3848453944808453)
- Inscryption: [GDC 2022ポストモーテム](https://gdcvault.com/play/1027609/Independent-Games-Summit-Sacrifices-Were) / [Thumbsticksインタビュー](https://www.thumbsticks.com/magic-myst-pokemon-inspire-inscryption/)
- Buckshot Roulette: [Godot公式ショーケース](https://godotengine.org/article/godot-showcase-buckshot-roulette/) / [80.lvインタビュー](https://80.lv/articles/buckshot-roulette-developer-on-making-the-game-solo-feedback-success)
- [Tabletop Tavern (Steam)](https://store.steampowered.com/app/3337380/Tabletop_Tavern/)
- Web 3D: [gltf-transform](https://gltf-transform.dev/) / [troika-three-text](https://github.com/protectwise/troika/blob/main/packages/troika-three-text/README.md) / [three.js性能100 tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- 低コスト路線: [プリレンダ背景パイプライン](https://www.jmeiners.com/pre-rendered-backgrounds/) / [pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css) / [Balatroジュース分析](https://blakecrosley.com/guides/design/balatro)
