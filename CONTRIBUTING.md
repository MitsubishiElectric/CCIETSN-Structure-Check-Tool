# Contributing / コントリビューション

Thank you for your interest in contributing to this project.
This guide explains the basic rules for reporting issues and submitting pull requests.

本プロジェクトへのコントリビューションに関心を持っていただきありがとうございます。
このガイドでは、Issue報告やPull Request提出時の基本ルールを説明します。

## Important Notes / 重要な注意

Before sharing information or submitting changes, keep the following points in mind.

情報共有や変更提出の前に、以下を確認してください。

- Do not include confidential information, internal links, customer information, or non-public specifications.
- 機密情報、社内リンク、顧客情報、非公開仕様を含めないでください。
- Do not commit CSP+ ZIP/BMP files or other source assets unless redistribution is clearly permitted.
- 再配布が明確に許可されていないCSP+ ZIP/BMPファイルや元データはコミットしないでください。
- Do not add code, data, images, or documents that you do not have the right to contribute.
- 投稿する権利を持たないコード、データ、画像、文書を追加しないでください。
- For large changes or behavior changes, open an issue first to discuss the scope and purpose.
- 大きな変更や挙動変更を行う場合は、先にIssueで目的と範囲を相談してください。

## Pull Request Process / Pull Requestの流れ

Use the following process when submitting a pull request.

Pull Requestを作成する場合は、以下の流れを基本としてください。

1. Create an issue, or check whether a related issue already exists. / Issueを作成する、または関連Issueがあるか確認する
2. Create a branch with a name that describes the change. / 変更内容が分かる名前でブランチを作成する
3. Implement the change with a focused scope. / 変更範囲を絞って実装する
4. Update tests and documentation when needed. / 必要に応じてテストやドキュメントを更新する
5. Run the checks that are relevant to your change. / 変更内容に応じて必要な確認を実行する
6. Add a Signed-off-by line to each commit. / 各commitにSigned-off-by行を追加する
7. Open a pull request with a clear summary, change details, and validation results. / 概要、変更内容、確認結果を記載してPull Requestを作成する

Example branch names / ブランチ名の例:

- `fix/validation-message`
- `docs/readme-update`
- `feat/device-defaults`
- `test/add-fixtures`

## Developer Certificate of Origin / 開発者原産地証明（DCO）

This project uses the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) to confirm that contributors have the right to submit their contributions.

本プロジェクトでは、投稿者がコントリビューションを提出する権利を持っていることを確認するため、Developer Certificate of Origin（DCO）を使用します。

Add a Signed-off-by line to each commit in a pull request.

Pull Requestに含まれる各commitに、Signed-off-by行を追加してください。

```text
Signed-off-by: Your Name <your.email@example.com>
```

You can add it automatically with the `-s` option.

`-s` オプションを付けると、自動で追加できます。

```bash
git commit -s -m "docs: update contributing guide"
```

DCO does not transfer copyright to this project and does not grant permission to use third-party content without the required rights.

DCOは、著作権を本プロジェクトへ譲渡するものではなく、第三者の著作物を許可なく使用できるようにするものでもありません。

## Project-Specific Changes / プロジェクト固有の変更

When changing usage, development flow, JSON format, device data, connection tables, or validation rules, update the related documentation under `docs/` as needed.
For detailed development procedures, see `docs/003_Development/_index.md`.

使い方、開発手順、JSONフォーマット、機器データ、接続テーブル、検証ルールを変更する場合は、必要に応じて `docs/` 配下の関連ドキュメントも更新してください。
詳しい開発手順は `docs/003_Development/_index.md` を参照してください。

## License / ライセンス

This project is licensed under the Apache License 2.0.
By submitting a contribution, you agree that your contribution will be licensed under the same license.

本プロジェクトはApache License 2.0の下でライセンスされています。
Pull Requestとして提出されたコントリビューションは、同じライセンスの下で扱われます。
