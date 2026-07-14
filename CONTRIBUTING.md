# Contributing

不具合修正、balance 調整、accessibility、翻訳、AI agent protocol の改善を歓迎します。
game rule を変える場合は、プレイヤーに生じる選択と既存 save data への影響を PR に
記載してください。

## Setup と確認

```bash
npm ci
npm test
npm run test:agent
```

画面変更は `npm run serve` で起動し、表示された localhost URL を browser で確認
してください。再現可能な gameplay bug には URL の `?seed=数字`、操作手順、browser
名を添えてください。screenshot test を使う場合は別途
`npx playwright install chromium` が必要です。

外部 code・asset・skill を追加する PR は、出典、license、改変内容を明記し、必要な
license text を `THIRD_PARTY_LICENSES.md` または対象 component の近くに同梱して
ください。生成物や Issue に token・個人情報・非公開素材を含めないでください。
