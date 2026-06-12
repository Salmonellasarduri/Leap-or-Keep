# アート生成プロンプト台帳(gpt-image-2 via Codex CLI)

> 再生成・追加時はこの台帳を使う。スタイル統一のため全プロンプトに STYLE ブロックを前置。

## STYLE(共通)

> Pulp sci-fi book cover illustration, painterly with bold shapes, deep space near-black background (#070b14), teal (#39d0ff) and amber (#ffb347) neon rim lighting, high contrast, slightly retro-futuristic, cinematic, no text, no watermark, no UI elements.

## アセット表

| ファイル | サイズ | 被写体 |
|---|---|---|
| title-hero.png | 1536x1024 | 小さな改造サルベージ船と随伴ドローンが、星雲の中に浮かぶ死んだ文明の巨大遺構ゲートへ向かう後ろ姿。畏怖と好奇心 |
| zone1.png | 1536x1024 | 残骸ベルト: 青暗い宇宙に漂う岩と難破船の帯。手前は暗く(盤面用に上下は空ける) |
| zone2.png | 1536x1024 | 海賊の墓場: 朽ちた海賊艦の群れ、赤いランタンの点、霧 |
| zone3.png | 1536x1024 | 囁きの星雲: 緑がかった発光ガス、クラゲめいた生体光 |
| zone4.png | 1536x1024 | 沈黙の前哨: オレンジに発光する古代の防衛ステーション残骸、幾何学的 |
| zone5.png | 1536x1024 | 中心墓所: 赤黒い空間に浮かぶ単一の巨大モノリス、神殿めいた静寂 |
| relic-nano.png | 1024x1024 | 銀色のナノ修復槽。中で何かが脈打つ。台座の上の聖遺物風 |
| relic-coil.png | 1024x1024 | 不安定な位相コイル。輪郭がにじみ二重に見える金属コイル |
| relic-anchor.png | 1024x1024 | 重力子アンカー。周囲の塵が落下していく黒い錨 |
| relic-fusion.png | 1024x1024 | ひび割れた融合炉。ひびから恒星の光が漏れる球体 |
| relic-starmap.png | 1024x1024 | 死文明の星図。消えた星々を示すホログラム盤 |
| relic-annihil.png | 1024x1024 | 殲滅プロトコル断片。禍々しい黒い結晶チップ、赤い微光 |
| ship-vagrants.png | 1024x1024 | 標準サルベージ艦ヴァグランツ。継ぎ接ぎの実用艦、シアンのライン |
| ship-bellyroll.png | 1024x1024 | 装甲衝角艦ベリーロール。分厚い艦首ラム、傷だらけ、アンバーのライン |
| ship-astra.png | 1024x1024 | 長距離砲撃艦アストラ。細長い船体に不釣り合いな長砲身、紫のライン |

## 運用メモ

- 生成: `codex exec -C <repo> -s workspace-write --skip-git-repo-check "<STYLE+指示>"`(画像ツールで art/ に保存させる)
- ゲームは art/ が無くても劣化動作する(CSSグラデフォールバック+img onerror非表示)
- 差し替えは同名上書きでよい
