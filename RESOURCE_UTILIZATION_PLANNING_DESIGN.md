# scheduler.etzhayyim.com リソース整理・定義・活用計画機能 設計

## 1. 目的
`scheduler.etzhayyim.com` において、ユーザーが保有する複数種類のリソースを統一的に管理し、目標達成のための実行可能な活用計画（いつ・何に・どの程度使うか）を立案できる機能を提供する。

想定リソース:
- credits
- 時間
- social capital
- knowledge
- contract
- asset

---

## 2. プロダクト要件

### 2.1 解決したい課題
- リソースの種類ごとに管理場所・単位・更新頻度がバラバラ。
- 目標（例: 新規プロジェクト立ち上げ、営業成果、採用）に対して、どのリソースがボトルネックか見えない。
- リソース消費と回復（補充）の見通しがなく、計画が破綻しやすい。

### 2.2 ユーザー価値
- リソースを「可視化・比較・優先付け」できる。
- 目標から逆算して「実行計画」に落とし込める。
- 計画の実績差分を追跡し、次回計画へ学習反映できる。

---

## 3. ドメインモデル（Resource Graph）

### 3.1 共通リソースエンティティ
すべてのリソースは共通基底型 `Resource` で扱う。

```ts
interface Resource {
  resourceId: string;
  userId: string;
  type: 'credits' | 'time' | 'social_capital' | 'knowledge' | 'contract' | 'asset';
  name: string;
  unit: string;               // credits, hours, score, document, contract_count, JPY
  quantity: number;           // 現在保有量
  qualityScore?: number;      // 品質・有効性の補助指標 (0..100)
  liquidityScore?: number;    // 即時活用しやすさ (0..100)
  confidenceScore?: number;   // データ信頼度 (0..100)
  refreshRate?: number;       // 単位期間あたりの回復量
  decayRate?: number;         // 単位期間あたりの劣化量
  constraints?: string[];     // 利用制約（期限、利用先制限、法務制約等）
  tags?: string[];
  metadata?: Record<string, unknown>;
}
```

### 3.2 タイプ別定義

1. **credits**
   - 単位: `credits`
   - 特徴: 定量管理しやすい、消費ログが取りやすい
   - 制約例: 月次上限、用途別バケット

2. **時間**
   - 単位: `hours`
   - 特徴: 1日24hのハード制約。回復は睡眠・休息依存
   - 制約例: 会議固定枠、集中作業時間帯

3. **social capital**
   - 単位: `score`（0-1000）
   - 構成: 信頼、関係密度、到達可能性
   - 制約例: 接触頻度過多による逆効果

4. **knowledge**
   - 単位: `knowledge_point` または `doc_count`
   - 構成: ドメイン知識、実装知識、運用知識
   - 制約例: 陳腐化、属人化

5. **contract**
   - 単位: `contract_count` / `MRR` / `expected_value`
   - 構成: 契約状態（lead, drafting, signed, renewing）
   - 制約例: 法務レビュー待ち、締結期限

6. **asset**
   - 単位: `JPY`、`hours_saved`、`reuse_score`
   - 構成: コード資産、テンプレート、設備、データ資産
   - 制約例: メンテコスト、陳腐化

---

## 4. 機能設計

### 4.1 Resource Inventory（整理・定義）
- リソース登録ウィザード
  - タイプ選択 → 単位選択 → 初期量入力 → 制約入力
- 自動正規化
  - 例: 分/時間、円/千円を標準単位に変換
- リソース健全性スコア
  - `health = weighted(quantity, qualityScore, liquidityScore, confidenceScore)`

### 4.2 Goal-to-Plan Planner（活用計画）
- ユーザーが目標を定義
  - 例: 「90日で新規顧客3社獲得」
- 目標テンプレートから必要リソースを推定
- ギャップ分析
  - `required - current - expected_recovery`
- 実行計画生成
  - 週次/日次タスク
  - 使うリソース、想定消費量、期待アウトカム

### 4.3 Scenario Simulator
- 複数シナリオ比較
  - Conservative / Balanced / Aggressive
- リスク可視化
  - 破綻点（credits不足、時間超過、契約遅延）をタイムライン表示

### 4.4 Tracking & Feedback
- 実績入力（手動 + API連携）
- 計画との差分分析
- 次周期の推奨調整
  - 消費抑制、補充優先、目標再設定

---

## 5. 画面設計（MVP）

1. **Resource Dashboard**
   - 総合ヘルススコア
   - リソース別残量、劣化/回復トレンド
   - ボトルネックカード

2. **Resource Catalog**
   - タイプ別一覧
   - 各リソース詳細（制約・履歴・関連目標）

3. **Planning Board**
   - 目標設定
   - 必要量推定
   - 週次タスク計画（ドラッグ＆ドロップ）

4. **Scenario Compare**
   - シナリオごとの達成確率・消費量比較

5. **Review（振り返り）**
   - 計画実績差分
   - 学習メモ

---

## 6. API設計（例）

### 6.1 Resource API
- `POST /api/resources`
- `GET /api/resources`
- `PATCH /api/resources/:resourceId`
- `POST /api/resources/:resourceId/events`（増減・品質変化）

### 6.2 Planning API
- `POST /api/goals`
- `POST /api/goals/:goalId/plan:generate`
- `POST /api/goals/:goalId/scenarios:simulate`
- `POST /api/plans/:planId/review`

### 6.3 出力例
```json
{
  "goalId": "goal_90d_sales_001",
  "planSummary": {
    "horizonDays": 90,
    "successProbability": 0.68,
    "criticalBottlenecks": ["time", "social_capital"]
  },
  "weeklyActions": [
    {
      "week": 1,
      "actions": [
        {
          "title": "紹介依頼5件",
          "resourceConsumption": {
            "time": 6,
            "social_capital": 12
          },
          "expectedOutcome": "商談2件"
        }
      ]
    }
  ]
}
```

---

## 7. データモデル（MVP）

### 7.1 テーブル
- `resources`
- `resource_events`
- `goals`
- `goal_requirements`
- `plans`
- `plan_actions`
- `plan_reviews`

### 7.2 主要カラム
- `resources`: `type`, `unit`, `quantity`, `quality_score`, `liquidity_score`, `constraints_json`
- `plan_actions`: `scheduled_at`, `resource_consumption_json`, `expected_outcome`, `status`
- `plan_reviews`: `variance_json`, `insights`, `next_adjustments_json`

---

## 8. 推奨アルゴリズム

### 8.1 ギャップ分析
`gap(resource) = required(resource) - current(resource) - replenishment(resource, horizon)`

### 8.2 優先順位付け
`priority = impact_to_goal / (consumption + risk_penalty)`

### 8.3 達成確率推定（初期）
- ルールベース + 重み付き線形モデルで開始
- 実績データ蓄積後にベイズ更新や時系列モデルへ拡張

---

## 9. 実装フェーズ

### Phase 1（2〜4週間）
- Resource Inventory
- Goal定義
- 単一シナリオの計画生成

### Phase 2（4〜6週間）
- Scenario Simulator
- 週次レビュー
- 推奨調整ロジック

### Phase 3（6週間〜）
- 外部連携（カレンダー、CRM、会計）
- 自動実績取り込み
- 予測モデル高度化

---

## 10. KPI
- 週次計画継続率
- 計画達成率
- リソース不足による計画中断率
- 目標達成までのリードタイム短縮率

---

## 11. 非機能要件
- API応答: 95パーセンタイル < 300ms（一覧系）
- 監査ログ: resource_events と review を完全記録
- 権限: ユーザー単位 + チーム共有時のスコープ制御
- 可観測性: 目標ごとの計画生成時間、失敗率、改善率

---

## 12. 受け入れ条件（MVP）
- ユーザーが6種類のリソースを登録・更新できる。
- 目標を1つ設定し、90日計画を生成できる。
- 計画に対して週次レビューを入力し、次週の推奨調整が表示される。
- ボトルネックとなるリソースが明示される。
