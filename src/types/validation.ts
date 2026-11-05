// SPDX-License-Identifier: Apache-2.0
/**
 * 検証ステータス
 */
export type ValidationStatus =
  | 'ALLOW' // 現在の設定で即許容
  | 'ALLOW_PENDING' // 軽微条件不足（周期設定等）。充足後ALLOWに
  | 'ALLOW_VIA_SWITCH' // スイッチ経由で許容
  | 'ALLOW_VIA_SWITCH_PENDING' // スイッチ迂回かつ脚注条件未充足
  | 'DENY'; // トポロジ/速度仕様上禁止

/**
 * 検証結果の重要度
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * 個別の検証結果
 */
export interface ValidationResult {
  id: string; // ユニークID
  severity: ValidationSeverity;
  status: ValidationStatus;
  message: string; // ユーザー向けメッセージ
  nodeIds?: string[]; // 関連するノードID
  edgeIds?: string[]; // 関連するエッジID
  details?: string; // 詳細情報（脚注、条件等）
}

/**
 * ネットワーク全体の検証結果
 */
export interface NetworkValidationResult {
  valid: boolean; // 全体として有効か（DENY が1つでもあれば false）
  results: ValidationResult[];
  timestamp: number;
}

/**
 * 接続可否表のセル情報
 */
export interface ConnectionTableCell {
  symbol: '○' | '△' | '×'; // 接続可否記号
  switchTypes?: ('S' | 'H' | 'N')[]; // 使用可能なスイッチ種別
  footnotes?: string[]; // 脚注（*1, *2, *3 等）
  status: ValidationStatus; // 対応する検証ステータス
}

/**
 * 接続ルール（2機器間の接続判定用）
 */
export interface ConnectionRule {
  // マスタに近い側の機器
  nearerDevice: {
    role: 'master' | 'local' | 'remote' | 'ethernet';
    deviceClass?: 'A' | 'B'; // ローカルは常にB、リモートはAまたはB
    speed: '1G' | '100M';
  };
  // マスタから遠い側の機器
  fartherDevice: {
    role: 'master' | 'local' | 'remote' | 'ethernet';
    deviceClass?: 'A' | 'B';
    speed: '1G' | '100M';
  };
  cell: ConnectionTableCell;
}
