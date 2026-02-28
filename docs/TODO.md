# TODO

## 未実装・改善案

### フェーズ分離型アーキテクチャ

- [x] Step 4: ゴール・パトロール統合の実装
  - ~~goal_check cron の役割変更（直接行動 → thought buffer 蓄積）~~
  - ~~patrol の出力に thought fragment 追加~~
- [ ] 未解決の検討事項への対応（詳細は [07-phased-architecture.md](./07-phased-architecture.md) セクション H 参照）
  - 複雑な会話への対応（検索結果を見て計画変更するフォールバック）
  - マルチターン会話での Phase 2 計画キャッシュ
  - voice モードでの Phase 2 省略
  - react モードでのフェーズスキップ
  - thought buffer の永続性・サイズ上限・自然減衰
  - 各フェーズでの LLM 不正出力時のフォールバック戦略
