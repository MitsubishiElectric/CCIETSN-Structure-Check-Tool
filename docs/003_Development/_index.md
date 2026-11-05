---
title: "開発者向け"
weight: 3
---
## 開発環境構築

### 必要なツール
- Node.js 18以上
- npm

### セットアップ
```bash
git clone https://github.com/MitsubishiElectric/CCIETSN-Structure-Check-Tool.git
cd CCIETSN-Structure-Check-Tool
npm install
```

`npm install` で開発用依存の `shx` もインストールされます。
`npm run dev` と `npm run build` の接続テーブルのコピー処理は `shx` を使用するため、Windows（cmd）・macOS・Linux で同じコマンドを使用できます。

---

## 第三者 OSS のライセンス告知

第三者 OSS を追加・更新した場合は、`public/THIRD-PARTY-NOTICES.txt` も更新してください。
アプリ本体だけでなく、開発・ビルド・テスト用の依存と間接依存も対象です。

対象バージョンのライセンス原文、著作権表示、必要な NOTICE などを収録してください。
更新時は、ライセンス条件や著作権表示に変更がないか確認してください。

---

## 開発コマンド

### 開発サーバー起動
```bash
npm run dev          # → http://localhost:5173
```
変更をプッシュすると、GitHub Actionsが自動でビルド・デプロイします。

### CSP機器情報の更新
ZIPファイルを Git管理外の `tools/csp_raw/` に追加・更新後、以下の順で実行：

`tools/csp_raw/` は CSP+ ZIP/BMP などの元データ置き場で、`.gitignore` によりGit管理対象外です。

```bash
# 1. CSPファイルをJSON化
npm run build:csp

# 2. CSVに同期（category・速度など）
npm run sync:csp

# 3. ツール用データを生成
npm run build:device-defaults
```

主に以下が更新されます。

```text
public/csp/csp-index.json
public/csp/img/
public/data/device-defaults.csv
public/data/device-defaults.json
src/data/device-defaults.json
```

`npm run build:csp` はCSP+ ZIP内の画像を抽出し、`public/csp/img/` に配置します。画像が取得できた場合は、`public/csp/csp-index.json` の `image` に画像パスが設定され、機器パレットで表示されます。

**機器のデフォルト値をカスタマイズする場合：**  
機器デフォルト値一覧（`public/data/device-defaults.csv`）を編集後、再度 `npm run build:device-defaults` を実行してください。

### テスト実行
初回のみ、Playwright のブラウザと依存ライブラリをインストールします（Linux では sudo が必要です）。
```bash
npx playwright install --with-deps chromium
```

```bash
npm run test:e2e
```

---

## テストケースの追加

### Fixturesフォルダ
テストケースは `tests/fixtures/` に JSON ファイルとして保存されます。

### ファイル命名規則
- **`ok-*.json`** → エラー0件を期待（正常系）
- **`ng-*.json`** → エラー1件以上を期待（異常系）

### 追加手順
1. ツールでネットワーク構成図を作成
2. テストしたい構成をJSON形式で保存
3. `tests/fixtures/` に保存（命名規則に従う）
4. テストケースを自動生成：
   ```bash
   npm run generate:test-cases
   ```
5. テストを実行して確認：
   ```bash
   npm run test:e2e
   ```

---

## CI/CD（GitHub Actions）

| ワークフロー | トリガー | 内容 |
|---|---|---|
| `ci.yml` | `main` へのPR | ビルド、E2Eテスト |
| `deploy-pages.yml` | `main` へのpush（`src/`・`public/` などの変更時） | ビルド、E2Eテスト。両方成功時のみ `gh-pages` へデプロイ |

ワークフローで使用するアクションは、GitHub Actionsのポリシーに従いコミットSHAで固定します。

### テスト失敗時の確認方法

#### 1. GitHub Actionsページで確認
https://github.com/MitsubishiElectric/CCIETSN-Structure-Check-Tool/actions

- ❌マークがついたワークフローをクリック
- 「Run E2E Tests」ステップを開いてエラーメッセージを確認

#### 2. 詳細レポートの確認
- ワークフロー実行ページ下部の「Artifacts」セクション
- `playwright-report` をダウンロード
- `index.html` を開いて詳細を確認
  - スクリーンショット
  - エラートレース
  - 詳細なログ

#### 3. 通知
- GitHubからメール通知が届く
- GitHubの通知ベル🔔に表示される

---

## プロジェクト構造

```
src/                    # React/TypeScript アプリ本体
├── components/         # UIコンポーネント
├── data/               # アプリが import するデータと接続テーブルのマスター
├── services/           # データ読込・保存・検証ロジック
├── store/              # 状態管理
├── types/              # TypeScript型定義
└── utils/              # ユーティリティ関数
public/                 # Viteで配信する静的ファイル
├── csp/                # CSP+ から生成した機器インデックスと画像
├── data/               # ブラウザから参照する公開データ
└── devices/            # パレットやノード表示で使う機器画像
docs/                   # 仕様書（Markdown）
scripts/                # データ生成・テスト生成スクリプト
tests/                  # Playwright E2Eテスト
images/                 # README/ドキュメント用画像
```

`public/data/connection-tables/` は編集元ではありません。
接続テーブルは `src/data/connection-tables/` をマスターとし、`npm run dev` または `npm run build` で `public/` / `dist/` にコピーされます。

### src/ 配下の主な構成

```
src/
├── components/          # UIコンポーネント
│   ├── FlowEditor.tsx  # メインエディタ
│   ├── DevicePalette.tsx # 機器リスト
│   ├── ValidationPanel.tsx # 検証結果パネル
│   └── nodes/          # カスタムノード
├── services/           # ビジネスロジック
│   ├── rules/          # バリデーションルール
│   ├── cspLoader.ts    # CSP読み込み
│   └── storage.ts      # ローカルストレージ
├── store/              # 状態管理
│   └── flowStore.ts    # Zustand store
├── types/              # TypeScript型定義
└── utils/              # ユーティリティ関数
```

---

## 構成機器の追加手順

構成機器を追加する方法は、CSP+ファイルがある場合とない場合で異なります。

### CSP+ファイルがある場合

CSP+ファイルがある機器は、CSP+ ZIPから機器情報と画像を取り込みます。
具体的な生成コマンドは、上記の「CSP機器情報の更新」を参照してください。

#### 手順

1. `tools/csp_raw/` にCSP+ ZIPファイルを配置する

    `tools/csp_raw/` はGit管理対象外です。CSP+ ZIPや元画像ファイルはコミットしません。

2. 「CSP機器情報の更新」の手順を実行する

3. 開発サーバーで確認する

    ```bash
    npm run dev
    ```

    右側の機器パレットに追加した機器が表示されること、ドラッグ&ドロップできること、Class/速度/ポート数などの初期値が期待通りであることを確認します。

#### 画像について

CSP+ ZIP内に画像が含まれている場合、`npm run build:csp` により `public/csp/img/` へ自動配置されます。

画像が表示されない場合は、以下を確認してください。

- CSP+ ZIP内に画像ファイルが含まれているか
- `public/csp/img/` に画像が生成されているか
- `public/csp/csp-index.json` の対象機器に `image` が設定されているか
- ブラウザで画像パスにアクセスできるか

### CSP+ファイルがない場合

CSP+ファイルがない機器は、機器デフォルト値一覧に手動で追加します。

#### 手順

1. `public/data/device-defaults.csv` を編集する

2. 追加する機器の分類に応じて、該当セクションに行を追加する

    ```text
    # === Master Devices ===
    # === Local/Remote Devices ===
    # === Switch Devices ===
    # === Ethernet Devices ===
    ```

    どのセクションに追加するかは、ツール上でその機器を何として扱うかで決めます。

    - マスタ局として扱う: `Master Devices`
    - ローカル局/リモート局として扱う: `Local/Remote Devices`
    - スイッチとして扱う: `Switch Devices`
    - PC/HMI/ソフトウェア/周辺機器として扱う: `Ethernet Devices`

3. 必要な列を設定する

    代表的な項目は以下です。

    - `deviceId`: 内部ID
    - `deviceName`: 表示名
    - `category`: 機器カテゴリ
    - `defaultClass`: デフォルトClass
    - `deviceClass`: 選択可能Class
    - `defaultPortCount`: デフォルトポート数
    - `minPorts`: 最小ポート数
    - `maxPorts`: 最大ポート数
    - `defaultPortType`: `ethernet` または `optical`
    - `supportsOpticalPorts`: 光ポート対応可否
    - `speed`: デフォルト速度
    - `speedOptions`: 選択可能速度
    - `supportsMulticastFilter`: マルチキャストフィルタ対応可否
    - `isRingCapable`: リング対応可否
    - `firmwareVersion`: ファームウェアバージョン
    - `protocolVersion`: プロトコルバージョン
    - `cycleSetting`: 周期設定
    - `cyclicDataBytes`: サイクリックデータサイズ

4. **機器パレットに定義を追加する（重要）**

    ⚠️ `device-defaults.csv` に追加しただけでは、パレット（右側の機器リスト）には表示されません。`src/components/DevicePalette.tsx` に機器定義を追加する必要があります。

    **4-1. 機器の種別に応じて該当リストを選択**

    - **ネットワーク機器**（スイッチ・Ethernet機器）  
      `NETWORK_DEVICES` リストに追加

    - **マスタ局専用機器**（MXコントローラ・モーションユニット等）  
      `MX_CONTROLLERS` または `MOTION_UNITS` リストに追加

    - **ローカル/リモート局**（汎用機器）  
      `GENERIC_DEVICES` リストに追加

    **4-2. リストへの定義を追加**

    例：ネットワーク機器の場合
    ```typescript
    const NETWORK_DEVICES: NetworkDevice[] = [
      // ... 既存の定義
      { 
        id: 'my-switch-001',                    // deviceId と一致させる
        label: 'MySwitch-001',                  // 表示名
        stationType: 'switch-classB',           // switch-classB / switch-classA / switch-general / ethernet-device
        description: 'カスタムスイッチ',
        image: 'devices/my-switch.png'          // 画像パス
      }
    ];
    ```

    ⚠️ **重要**: `id` フィールドは `device-defaults.csv` の `deviceId` と**完全に一致**している必要があります。

5. 機器デフォルト値JSONを生成する

    ```bash
    npm run build:device-defaults
    ```

    主に以下が更新されます。

    ```text
    public/data/device-defaults.json
    src/data/device-defaults.json
    ```

6. 開発サーバーで確認する

    ```bash
    npm run dev
    ```

#### 画像について

CSP+ファイルがない機器では、画像は自動生成されません。

既存の汎用画像を使う場合は、追加作業は不要です。専用画像を使いたい場合は、画像ファイルを `public/devices/` に追加し、パレット定義側でその画像パスを指定する必要があります。

例:

```text
public/devices/melsoft-vima.png
```

画像パスの指定例:

```ts
image: 'devices/melsoft-vima.png'
```

現在の実装では、`public/data/device-defaults.csv` だけでは画像パスを指定できません。専用画像を表示したい場合は、`src/components/DevicePalette.tsx` 側の定義追加も必要です。

まずは既存の汎用画像で仮追加し、専用表示が必要になった段階で画像とパレット定義を追加することを推奨します。

### 追加時の確認観点

PRを作成する前に、以下を確認してください。

- 機器パレットに追加機器が表示される
- ドラッグ&ドロップでキャンバスに配置できる
- Class、速度、ポート数などの初期値が仕様通り
- パラメータ設定ダイアログの内容が仕様通り
- 検証結果が期待通り
- `npm run build` が成功する
- 必要に応じて `npm run test:e2e` が成功する
- CSP+ ZIPなど、Git管理対象外の元データをコミットしていない

---

## 未実装マスタ局への制約追加手順

### 📋 追加する制約の種類を判断

既存のマスタ局に固有の制約を追加する場合、以下を確認：

**Q1. そのマスタ局専用の接続ルールがある？**
- スイッチ設定による接続可否
- リング/ローカル局の可否
- プロトコルバージョンや通信速度の制約
- ClassB/BA混在の詳細ルール

→ **YES**: ステップ1（JSON作成）へ

**Q2. JSON では表現できない固有ロジックがある？**
- 接続数や台数の制限（例：MXRの121ステーション制限）
- 複雑な条件分岐
- ファームウェアバージョンによる警告

→ **YES**: ステップ2（TSファイル作成）へ

---

### ステップ1: 接続テーブルJSON の追加

#### やること
`src/data/connection-tables/型番.json` を作成

`public/data/connection-tables/` と `dist/data/connection-tables/` は、開発サーバー起動時またはビルド時に `src/data/connection-tables/` からコピーされます。

#### JSONの構造
```json
{
  "deviceType": "型番",
  "classification": "B_ONLY | BA_MIXED",
  "allowsRingTopology": true/false,
  "allowsLocalStation": true/false,
  "switchSettings": [
    {
      "switchType": "S" | "H" | "N",
      "constraints": { /* 制約内容 */ }
    }
  ]
}
```

#### 参考ファイル
- シンプル: `src/data/connection-tables/MXF100-8-N32.json`
- 複雑: `src/data/connection-tables/RJ71GN11-T2.json`

---

### ステップ2: 固有ルールTS の追加

#### やること
1. `src/services/rules/xxxRule.ts` を作成
2. `src/services/rules/index.ts` に組み込み

#### xxxRule.ts の必須要素
- `validateXxx(nodes, edges): ValidationError[]` 関数をエクスポート
- マスタ局を `nodes.find()` で特定
- 制約違反時に `{ id, type, message, severity }` を返す

#### index.ts への組み込み
- import文を追加（冒頭）
- `validateFlow()` 内で `errors.push(...validateXxx(nodes, edges));` を追加

#### 参考ファイル
`src/services/rules/mxr121StationsRule.ts`

---

### ✅ 実装完了の確認

- [ ] JSONファイルが `src/data/connection-tables/` に配置されている
- [ ] ルールTSファイルが作成されている
- [ ] index.ts に import とルール呼び出しを追加している
- [ ] ブラウザで動作確認（エラーが正しく表示される）

---

## 制約条件の追加手順

制約条件を追加する場合は、まず既存の接続テーブルや検証ルールで表現できるかを確認します。
制約の種類によって、追加先は `src/data/connection-tables/`、`src/services/rules/`、または既存ルールの修正に分かれます。

### 追加先の判断

#### 接続可否やスイッチ設定で表現できる制約

以下のような制約は、接続テーブルJSONへの追加を優先します。

- マスタ局とローカル局/リモート局の接続可否
- スイッチ種別ごとの接続可否
- リング構成の可否
- Class B / Class BA混在時の接続条件

追加・修正先:

```text
src/data/connection-tables/
```

`public/data/connection-tables/` と `dist/data/connection-tables/` は生成先です。直接編集せず、`src/data/connection-tables/` を編集してください。

#### 全体構成を見て判定する制約

以下のような制約は、TypeScriptの検証ルールとして追加します。

- 接続台数やステーション数の上限
- 複数ノードを横断して判定する条件
- 特定機器の組み合わせに依存する条件
- ファームウェアバージョンやパラメータ値に依存する条件
- エラーではなく警告として表示したい条件

追加・修正先:

```text
src/services/rules/
```

### 実装手順

1. 既存ルールで対応できるか確認する

    まず、以下の既存ルールを確認します。

    ```text
    src/services/rules/connectionTableRule.ts
    src/services/rules/maxStationsRule.ts
    src/services/rules/multicastSwitchPortRule.ts
    src/services/rules/baBoundarySwitchRule.ts
    src/services/rules/switchBoundaryCyclicDataRule.ts
    src/services/rules/mxr121StationsRule.ts
    ```

    既存ルールの条件追加で表現できる場合は、新しいルールファイルを増やさず、既存ルール側に追加します。

2. 接続テーブルJSONで表現できる場合はJSONを追加・修正する

    マスタ局ごとの接続条件は、`src/data/connection-tables/型番.json` に追加します。

    参考:

    ```text
    src/data/connection-tables/MXF100-8-N32.json
    src/data/connection-tables/RJ71GN11-T2.json
    ```

3. TypeScriptルールが必要な場合はルールファイルを追加する

    `src/services/rules/xxxRule.ts` を作成し、検証関数をエクスポートします。

    ```ts
    import { Edge, Node } from 'reactflow';
    import { FlowNodeData } from '../../types/flow';
    import { ValidationResult } from '../../types/validation';

    export function validateXxx(
      nodes: Node<FlowNodeData>[],
      edges: Edge[]
    ): ValidationResult[] {
      const results: ValidationResult[] = [];

      return results;
    }
    ```

4. ルールを検証フローに組み込む

    `src/services/rules/index.ts` に import を追加し、`validateFlow()` 内で呼び出します。

    ```ts
    errors.push(...validateXxx(nodes, edges));
    ```

5. エラーメッセージを確認する

    追加した制約に違反する構成を作成し、検証結果パネルに意図したメッセージが表示されることを確認します。

### 確認観点

PRを作成する前に、以下を確認してください。

- 制約に違反する構成でエラーまたは警告が表示される
- 制約に違反しない構成ではエラーが表示されない
- 既存の正常系構成が新しい制約で壊れていない
- エラーメッセージが利用者にとって原因を特定しやすい
- 接続テーブルJSONを追加した場合、`npm run dev` または `npm run build` で生成先へ反映される
- `npm run build` が成功する
- 必要に応じて `npm run test:e2e` が成功する

---

## JSONフォーマット仕様

外部ツールがネットワーク構成を生成する場合、以下の仕様に従ってJSONを作成してください。

### 最小限の構造
```json
{
  "version": 1,
  "nodes": [],
  "edges": [],
  "communicationMode": "unicast"
}
```

| フィールド          | 型                           | 必須     | 説明                             |
| ------------------- | ---------------------------- | -------- | -------------------------------- |
| `version`           | number                       | 推奨     | スキーマバージョン。現在は `1`   |
| `updatedAt`         | string (ISO8601)             | 不要     | タイムスタンプ（省略可）         |
| `communicationMode` | `"unicast"` \| `"multicast"` | 推奨     | 通信モード。デフォルト `unicast` |
| `nodes`             | Node[]                       | **必須** | デバイスノード配列               |
| `edges`             | Edge[]                       | **必須** | 接続エッジ配列                   |

---

### ノード（機器）の構造

```json
{
  "id": "任意のユニークな文字列",
  "type": "deviceClass",
  "position": { "x": 100, "y": 200 },
  "data": { /* デバイス情報 */ }
}
```

#### `data` フィールド

**マスタ局（ネットワークに1台必須）**
```json
{
  "label": "RJ71GN11-T2",
  "stationType": "master",
  "isMaster": true,
  "stationNumber": 0,
  "deviceClass": "B",
  "speed": "1G",
  "portCount": 2,
  "portType": "ethernet",
  "maxStations": 121,
  "protocolVersion": "2.0",
  "supportsMulticastFilter": true,
  "isRingCapable": true
}
```

**ローカル局 / リモート局**
```json
{
  "label": "MR-J5-G",
  "stationType": "remote",
  "isMaster": false,
  "stationNumber": 1,
  "deviceClass": "B",
  "speed": "100M",
  "portCount": 2,
  "portType": "ethernet",
  "protocolVersion": "2.0",
  "cycleSetting": "BASIC",
  "cyclicDataBytes": 40
}
```

**スイッチ**
```json
{
  "label": "産業用スイッチ（Class B対応）",
  "stationType": "switch-classB",
  "isMaster": false,
  "portCount": 8,
  "portType": "ethernet"
}
```

#### 主要フィールド

| フィールド                | 型      | 必須     | 説明                                                                                                                         |
| ------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `label`                   | string  | **必須** | 機器名またはモデル名                                                                                                         |
| `stationType`             | string  | **必須** | `"master"` \| `"local"` \| `"remote"` \| `"switch-classB"` \| `"switch-classA"` \| `"switch-general"` \| `"ethernet-device"` |
| `isMaster`                | boolean | 推奨     | マスタ局のみ `true`                                                                                                          |
| `stationNumber`           | number  | 推奨     | マスタ: `0`、ローカル/リモート: `1`～`253`                                                                                   |
| `deviceClass`             | string  | 推奨     | `"A"` \| `"B"`                                                                                                               |
| `speed`                   | string  | 推奨     | `"100M"` \| `"1G"`                                                                                                           |
| `portCount`               | number  | 推奨     | ポート数（1～8、デフォルト `2`）                                                                                             |
| `portType`                | string  | 推奨     | `"ethernet"` \| `"optical"`                                                                                                  |
| `protocolVersion`         | string  | 任意     | `"1.0"` \| `"2.0"`                                                                                                           |
| `supportsMulticastFilter` | boolean | 任意     | マルチキャストフィルタ対応可否                                                                                               |
| `isRingCapable`           | boolean | 任意     | リング対応可否                                                                                                               |
| `cycleSetting`            | string  | 任意     | `"LOW"` \| `"BASIC"` \| `"MID"`（ローカル/リモート局）                                                                       |
| `cyclicDataBytes`         | number  | 任意     | サイクリックデータバイト数                                                                                                   |

---

### エッジ（接続）の構造

```json
{
  "id": "任意のユニークな文字列",
  "source": "ノードID",
  "target": "ノードID",
  "sourceHandle": "port1_out",
  "targetHandle": "port1_in"
}
```

| フィールド     | 型     | 必須     | 説明                                   |
| -------------- | ------ | -------- | -------------------------------------- |
| `id`           | string | **必須** | ユニークなID                           |
| `source`       | string | **必須** | 接続元ノードID                         |
| `target`       | string | **必須** | 接続先ノードID                         |
| `sourceHandle` | string | 推奨     | `"port{N}_out"` 形式（N=1～portCount） |
| `targetHandle` | string | 推奨     | `"port{N}_in"` 形式（N=1～portCount）  |

---

### 実装時のガイドライン

- **position**: UIの配置座標。検証には影響しないため任意の値でOK
- **stationNumber**: 重複不可（マスタ以外は1～253）
- **マスタ局**: 正確に1台必須。`stationType: "master"`, `isMaster: true`, `stationNumber: 0`
- **handles**: sourceHandle/targetHandle は省略してもインポート成功するが、接続チェックの精度向上のため記載推奨
- **参考ファイル**: [tests/fixtures/](../../../tests/fixtures/) 配下の既存JSONが実装例になります

---
