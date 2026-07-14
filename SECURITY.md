# セキュリティポリシー

## サポート対象

セキュリティ修正は最新の GitHub Release と現在の `main` を対象にします。古い
リリースへは backport しない場合があります。

## 脆弱性の報告

脆弱性の疑いは公開 Issue に書かず、
[GitHub の非公開脆弱性報告](https://github.com/Salmonellasarduri/Leap-or-Keep/security/advisories/new)
を使ってください。

対象 version または commit、影響、browser / Node.js 環境、最小再現手順を含めて
ください。token、個人情報、未公開データ、実在ユーザーの保存データは添付しないで
ください。

MCP / agent protocol の入力検証、static server の path 処理、保存データや share
内容の漏えい、GitHub Pages 上の script 実行に関する報告は特に重要です。通常の
gameplay bug は公開の bug report form を利用できます。
