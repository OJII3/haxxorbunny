---
name: create-pr
description: プルリクエスト作成。PR作成後にレビューを実行し、推奨修正項目があれば自動修正する。
user_invocable: true
---

# create-pr スキル

プルリクエストを作成し、セルフレビュー＆自動修正まで行うスキル。

## 手順

### 1. 前提チェック

- 現在のブランチが main / feat/initial-setup でないことを確認。もし main にいる場合はエラーを伝えて終了。
- `nr typecheck && nr lint` を実行し、エラーがあれば修正してコミット。

### 2. 変更内容の把握

以下を並列で実行:

- `git status` で未コミットの変更を確認。未コミットの変更があればコミットする。
- `git log --oneline feat/initial-setup..HEAD` でコミット一覧を取得
- `git diff feat/initial-setup...HEAD --stat` で変更ファイルの統計を取得
- `git diff feat/initial-setup...HEAD` で全差分を取得

### 3. PR の作成

`gh pr create` で PR を作成する（**draft ではない通常の PR**）。

- base ブランチは `feat/initial-setup`
- タイトルは70文字以内で変更内容を端的に表現
- body は `.github/pull_request_template.md` のフォーマットに従う
- テンプレートの各セクションを実際の変更内容に基づいて埋める

```bash
gh pr create --base feat/initial-setup --title "タイトル" --body "$(cat <<'EOF'
## Summary

変更の概要

## Changes

- 変更点1
- 変更点2

## Type

- [x] 該当するタイプ

## Test plan

- [x] `nr typecheck` 通過
- [x] `nr lint` 通過
- [x] `bun test` 通過
EOF
)"
```

### 4. セルフレビュー（subagent）

PR 作成後、Task ツール（subagent_type=general-purpose）を起動してレビューを実行する。

subagent に渡すプロンプト:

```
以下の PR をレビューしてください。

1. `gh pr diff <PR番号>` で差分を取得
2. 以下の観点でレビュー:
   - 型安全性（TypeScript strict mode 準拠か）
   - セキュリティ（injection, 情報漏洩等）
   - エラーハンドリング
   - コードの一貫性（既存コードスタイルとの整合）
   - 不要なコード・コメントの残存
   - CLAUDE.md との整合性
3. 修正が必要な項目をリストアップ（ファイルパス:行番号 + 修正内容）
4. 「推奨修正」と「任意改善」を分けて報告

結果を以下の形式で返してください:
- critical: 必ず修正すべき項目（バグ、型エラー、セキュリティ）
- recommended: 修正を推奨する項目（コードスタイル、一貫性）
- optional: 任意の改善提案
```

### 5. 推奨修正の実施

レビュー結果の `critical` と `recommended` の項目を修正する:

1. 各修正項目に対して該当ファイルを Read → Edit で修正
2. 修正後 `nr typecheck && nr lint` で確認
3. 修正をコミット＆プッシュ（コミットメッセージ: `fix: PR review で指摘された項目を修正`）

`optional` の項目は修正せず、レビュー結果としてユーザーに報告する。

### 6. 結果報告

ユーザーに以下を伝える:

- PR の URL
- レビューで見つかった項目の概要
- 修正した項目
- 未修正の optional 項目（あれば）
