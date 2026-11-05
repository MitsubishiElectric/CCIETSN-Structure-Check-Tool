// SPDX-License-Identifier: Apache-2.0
import { Node, Edge } from 'reactflow';
import { nanoid } from 'nanoid';
import { FlowNodeData } from '../../types/flow';
import {
  ValidationResult,
  ValidationStatus,
  ConnectionTableCell,
} from '../../types/validation';
import { determineNearerAndFarther, hasClassADevices, findPath, getSwitchType } from './graphUtils';
import { getConnectionTable } from '../connectionTableLoader';

/**
 * 内部検証結果の型（met プロパティを含む）
 */
interface InternalValidationResult {
  met: boolean;
  reason?: string;
  severity?: 'warning' | 'error';
}

/**
 * JSON テーブルから cell を検索（from/to でマッチング）
 */
function findCellFromJsonTable(
  jsonTable: import('@/types/connectionTable').ConnectionTable | null,
  nearerKey: string,
  fartherKey: string
): { status: string; switches?: string[]; conditions?: any[] } | null {
  if (!jsonTable?.rows) {
    console.log(`[findCellFromJsonTable] jsonTable.rows がない`);
    return null;
  }

  console.log(`[findCellFromJsonTable] 検索: ${nearerKey} → ${fartherKey}`);
  console.log(`[findCellFromJsonTable] rows数: ${jsonTable.rows.length}`);
  console.log(`[findCellFromJsonTable] 利用可能な遷移: ${jsonTable.rows.map(r => `${r.from}→${r.to}`).join(', ')}`);

  const row = jsonTable.rows.find(r => r.from === nearerKey && r.to === fartherKey);
  if (!row) {
    console.log(`[findCellFromJsonTable] マッチするrowなし`);
    return null;
  }

  console.log(`[findCellFromJsonTable] マッチ! status=${row.status}, conditions=${row.conditions?.length || 0}個`);
  return {
    status: row.status,
    switches: row.switches,
    conditions: row.conditions,
  };
}

/**
 * スイッチ種別の略語を日本語表記に変換
 */
function formatSwitchType(type: string): string {
  switch (type) {
    case 'S':
      return 'Class B対応';
    case 'H':
      return 'Class A対応';
    case 'N':
      return '一般';
    default:
      return type;
  }
}

// ============================================================================
// 接続可否表定義
// ============================================================================
// 8パターンの接続表:
// 1. Class Bのみ ユニキャスト 1Gbpsマスタ
// 2. Class Bのみ ユニキャスト 100Mbpsマスタ
// 3. Class B/A混在 ユニキャスト 1Gbpsマスタ
// 4. Class B/A混在 ユニキャスト 100Mbpsマスタ
// 5. Class Bのみ マルチキャスト 1Gbpsマスタ
// 6. Class Bのみ マルチキャスト 100Mbpsマスタ
// 7. Class B/A混在 マルチキャスト 1Gbpsマスタ
// 8. Class B/A混在 マルチキャスト 100Mbpsマスタ
//
// 表の見方:
// - 行（key）: マスタに近い側の機器
// - 列（value）: マスタから遠い側の機器
// - symbol: ○=接続可, △=産業用スイッチ経由で接続可, ×=接続不可
// - switchTypes: S=Class B対応産業用スイッチ, H=Class A対応産業用スイッチ, N=一般スイッチ
// - footnotes: 脚注番号（条件付き許可の条件）
// - status: ALLOW/ALLOW_PENDING/ALLOW_VIA_SWITCH/ALLOW_VIA_SWITCH_PENDING/DENY
// ============================================================================

/**
 * パターン1: Class Bのみ ユニキャスト 1Gbpsマスタ
 * 脚注: *1=周期設定 低速, *2=サイクリックデータサイズ2K以下, *3=FW制約(P1/P2片側のみ)
 */
const CONNECTION_TABLE_CLASSB_UNICAST_1G: Record<string, Record<string, ConnectionTableCell>> = {
  'master-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'local-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'remote-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * パターン2: Class Bのみ ユニキャスト 100Mbpsマスタ
 * 脚注: *1=周期設定 基本周期/中速
 */
const CONNECTION_TABLE_CLASSB_UNICAST_100M: Record<string, Record<string, ConnectionTableCell>> = {
  'master-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  'local-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  'remote-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * パターン3: Class B/A混在 ユニキャスト 1Gbpsマスタ
 * 脚注: *1=周期設定 低速, *2=サイクリックデータサイズ2K以下
 */
const CONNECTION_TABLE_BA_UNICAST_1G: Record<string, Record<string, ConnectionTableCell>> = {
  // マスタ局 B 1G の行
  'master-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH' },
  },
  // ローカル局 B 1G の行
  'local-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH' },
  },
  // ローカル局 B 100M の行（すべて×）
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  // リモート局 B 1G の行
  'remote-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH' },
  },
  // リモート局 B 100M の行
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  // リモート局 A 1G の行（重要: ローカルBとリモートBには接続不可）
  'remote-A-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH' },
  },
  // リモート局 A 100M の行（重要: ローカルBとリモートBには接続不可）
  'remote-A-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  // Ethernet機器の行（すべて×: Ethernet機器の後ろには接続不可）
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * パターン4: Class B/A混在 ユニキャスト 100Mbpsマスタ
 */
const CONNECTION_TABLE_BA_UNICAST_100M: Record<string, Record<string, ConnectionTableCell>> = {
  // マスタ局 B 100M の行
  'master-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  // ローカル局 B 1G の行（すべて×）
  'local-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  // ローカル局 B 100M の行
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  // リモート局 B 1G の行（すべて×）
  'remote-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  // リモート局 B 100M の行
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  // リモート局 A 1G の行（すべて×）
  'remote-A-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  // リモート局 A 100M の行
  'remote-A-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  // Ethernet機器の行（すべて×: Ethernet機器の後ろには接続不可）
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * パターン5: Class Bのみ マルチキャスト 1Gbpsマスタ
 * 脚注: *1=周期設定 低速, *2=転送禁止設定, *3=FW制約(Ethernet機器接続時), 
 *       *4=サイクリックデータサイズ2K以下, *5=FW制約(P1/P2片側のみ), *6=マルチキャストフィルタ対応
 */
const CONNECTION_TABLE_CLASSB_MULTICAST_1G: Record<string, Record<string, ConnectionTableCell>> = {
  'master-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'local-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'remote-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * パターン6: Class Bのみ マルチキャスト 100Mbpsマスタ
 * 脚注: *1=周期設定 基本周期/中速, *2=FW制約(Ethernet機器接続時), 
 *       *3=転送禁止設定(終端側混在時), *4=マルチキャストフィルタ対応
 */
const CONNECTION_TABLE_CLASSB_MULTICAST_100M: Record<string, Record<string, ConnectionTableCell>> = {
  'master-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'local-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'remote-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * パターン7: Class B/A混在 マルチキャスト 1Gbpsマスタ
 * 脚注: *1=周期設定 低速, *2=転送禁止設定(速度混在/機器混在時), 
 *       *3=マルチキャストフィルタ対応, *4=サイクリックデータサイズ2K以下
 */
const CONNECTION_TABLE_BA_MULTICAST_1G: Record<string, Record<string, ConnectionTableCell>> = {
  'master-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'local-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'remote-B-1G': {
    'local-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-100M': { symbol: '△', switchTypes: ['S'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH_PENDING' },
  },
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'remote-A-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'remote-A-100M': { symbol: '△', switchTypes: ['S', 'H'], status: 'ALLOW_VIA_SWITCH_PENDING' },
    'ethernet-1G': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
    'ethernet-100M': { symbol: '△', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_VIA_SWITCH' },
  },
  'remote-A-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * パターン8: Class B/A混在 マルチキャスト 100Mbpsマスタ
 * 脚注: *1=周期設定 基本周期/中速, *2=転送禁止設定(終端側混在時), *3=マルチキャストフィルタ対応
 */
const CONNECTION_TABLE_BA_MULTICAST_100M: Record<string, Record<string, ConnectionTableCell>> = {
  'master-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'local-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'local-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'remote-B-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'remote-B-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '○', switchTypes: ['S'], status: 'ALLOW_PENDING' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW_PENDING' },
  },
  'remote-A-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'remote-A-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '○', switchTypes: ['S', 'H'], status: 'ALLOW_PENDING' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '○', switchTypes: ['S', 'H', 'N'], status: 'ALLOW' },
  },
  'ethernet-1G': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
  'ethernet-100M': {
    'local-B-1G': { symbol: '×', status: 'DENY' },
    'local-B-100M': { symbol: '×', status: 'DENY' },
    'remote-B-1G': { symbol: '×', status: 'DENY' },
    'remote-B-100M': { symbol: '×', status: 'DENY' },
    'remote-A-1G': { symbol: '×', status: 'DENY' },
    'remote-A-100M': { symbol: '×', status: 'DENY' },
    'ethernet-1G': { symbol: '×', status: 'DENY' },
    'ethernet-100M': { symbol: '×', status: 'DENY' },
  },
};

/**
 * マスタ速度に応じた周期設定チェック
 * - マスタ1G: 100Mbpsデバイス局は「低速」(LOW)必須
 * - マスタ100M: 100Mbpsデバイス局は「基本周期」(BASIC)または「中速」(MID)必須
 */
function checkCycleSettingByMasterSpeed(
  node: Node<FlowNodeData>,
  masterSpeed: '1G' | '100M',
  _otherNode: Node<FlowNodeData>,
  nodes: Node<FlowNodeData>[]
): InternalValidationResult {
  // 自ノードが100Mbpsデバイス局かどうかを確認
  if (node.data.speed !== '100M') {
    // 100Mbpsでなければチェック不要
    console.log(`  [checkCycleSettingByMasterSpeed] ノード速度: ${node.data.speed} (100Mbps以外 → スキップ)`);
    return { met: true };
  }

  // ローカル局またはリモート局かを確認
  if (node.data.stationType !== 'local' && node.data.stationType !== 'remote') {
    // デバイス局でなければチェック不要
    console.log(`  [checkCycleSettingByMasterSpeed] ノード種別: ${node.data.stationType} (デバイス局以外 → スキップ)`);
    return { met: true };
  }

  // cycleSetting を確認
  const cycleSetting = node.data.cycleSetting;
  console.log(`  [checkCycleSettingByMasterSpeed] ノード: "${node.data.label}", マスタ速度: ${masterSpeed}, cycleSetting: ${cycleSetting}`);

  // cycleSetting を日本語に変換
  const cycleSettingMap: Record<string, string> = {
    'LOW': '低速',
    'MID': '中速',
    'BASIC': '基本周期'
  };
  const cycleSettingLabel = cycleSetting ? cycleSettingMap[cycleSetting] || cycleSetting : '未設定';

  if (masterSpeed === '1G') {
    // マスタが1Gの場合: 「低速」のみOK
    if (cycleSetting === 'LOW') {
      console.log(`    → 1Gマスタ: "低速"設定 OK`);
      return { met: true };
    } else if (!cycleSetting) {
      console.log(`    → 1Gマスタ: 未設定 (警告)`);
      return {
        met: false,
        severity: 'warning',
        reason: `通信速度100Mbpsのデバイス局 "${node.data.label}" の通信周期設定が未設定です`
      };
    } else {
      console.log(`    → 1Gマスタ: "${cycleSettingLabel}"設定 (エラー)`);
      return {
        met: false,
        severity: 'error',
        reason: `通信速度100Mbpsのデバイス局 "${node.data.label}" の通信周期設定が"低速"に設定されていません (現在: ${cycleSettingLabel})`
      };
    }
  } else if (masterSpeed === '100M') {
    // マスタが100Mの場合: 「基本周期」または「中速」のみOK
    if (cycleSetting === 'BASIC' || cycleSetting === 'MID') {
      console.log(`    → 100Mマスタ: "${cycleSettingLabel}"設定 OK`);
      return { met: true };
    } else if (!cycleSetting) {
      console.log(`    → 100Mマスタ: 未設定 (警告)`);
      return {
        met: false,
        severity: 'warning',
        reason: `通信速度100Mbpsのデバイス局 "${node.data.label}" の通信周期設定が未設定です`
      };
    } else {
      console.log(`    → 100Mマスタ: "${cycleSettingLabel}"設定 (エラー)`);
      return {
        met: false,
        severity: 'error',
        reason: `通信速度100Mbpsのデバイス局 "${node.data.label}" の通信周期設定が"基本周期"または"中速"に設定されていません (現在: ${cycleSettingLabel})`
      };
    }
  }

  // その他の速度（想定外）
  console.log(`  [checkCycleSettingByMasterSpeed] 想定外のマスタ速度: ${masterSpeed}`);
  return { met: true };
}

/**
 * マスタポート制約をチェック
 * - ファームウェアバージョンが11以下の場合、P1またはP2のいずれか一方のみ使用可能
 * - 適用条件: RJ71GN11-T2, ユニキャスト, マスタ1G, クラスB, ネットワークに100M機器存在
 */
function checkMasterPortConstraint(
  masterNode: Node<FlowNodeData>,
  _otherNode: Node<FlowNodeData>,
  _nodes: Node<FlowNodeData>[],
  edges: Edge[],
  maxFirmwareVersion: number = 11  // デフォルトは 11（ユニキャスト用）
): InternalValidationResult {
  // マスタのファームウェアバージョンを確認
  const firmwareVersion = masterNode.data.firmwareVersion;
  console.log(`  [checkMasterPortConstraint] マスタ: "${masterNode.data.label}", FW version: ${firmwareVersion}, maxFirmwareVersion: ${maxFirmwareVersion}`);

  // ファームウェアバージョンが制限値より大きい場合は制約なし
  if (firmwareVersion === undefined || firmwareVersion > maxFirmwareVersion) {
    console.log(`  [checkMasterPortConstraint] FW version > ${maxFirmwareVersion} or undefined → 制約なし`);
    return { met: true };
  }

  // FW version <= maxFirmwareVersion の場合、P1/P2 使用状態をチェック
  console.log(`  [checkMasterPortConstraint] FW version <= ${maxFirmwareVersion} → ポート制約あり`);

  // マスタの接続されているエッジを取得
  const masterEdges = edges.filter(e => e.source === masterNode.id || e.target === masterNode.id);
  console.log(`  [checkMasterPortConstraint] マスタ接続エッジ数: ${masterEdges.length}`);
  
  // デバッグ: エッジの詳細を出力
  masterEdges.forEach((edge, idx) => {
    console.log(`    エッジ${idx}: source=${edge.source}, sourceHandle=${edge.sourceHandle}, target=${edge.target}, targetHandle=${edge.targetHandle}`);
  });

  // ポート情報を抽出
  const usedPorts = new Set<string>();
  for (const edge of masterEdges) {
    const sourceHandle = edge.sourceHandle || '';
    const targetHandle = edge.targetHandle || '';
    
    console.log(`  [checkMasterPortConstraint] エッジ処理: source=${edge.source}, target=${edge.target}`);
    console.log(`    sourceHandle="${sourceHandle}", targetHandle="${targetHandle}"`);
    
    // マスタがソースの場合（マスタから出ていく接続）
    if (edge.source === masterNode.id) {
      console.log(`    マスタがソース。sourceHandle="${sourceHandle}"`);
      // ハンドルID形式: "port1_out", "port2_out" など
      if (sourceHandle) {
        const match = sourceHandle.match(/port([12])/);
        if (match) {
          usedPorts.add(match[1] === '1' ? 'P1' : 'P2');
          console.log(`    → ポート検出: P${match[1]}`);
        }
      }
    }
    
    // マスタがターゲットの場合（マスタへ入ってくる接続）
    if (edge.target === masterNode.id) {
      console.log(`    マスタがターゲット。targetHandle="${targetHandle}"`);
      if (targetHandle) {
        const match = targetHandle.match(/port([12])/);
        if (match) {
          usedPorts.add(match[1] === '1' ? 'P1' : 'P2');
          console.log(`    → ポート検出: P${match[1]}`);
        }
      }
    }
  }

  console.log(`  [checkMasterPortConstraint] 使用ポート: ${Array.from(usedPorts).join(', ')}`);

  // P1とP2が両方使用されている場合はエラー
  if (usedPorts.has('P1') && usedPorts.has('P2')) {
    console.log(`  [checkMasterPortConstraint] P1とP2が両方使用 → エラー`);
    return {
      met: false,
      severity: 'error',
      reason: `ファームウェアバージョンが${firmwareVersion}の場合、マスタのポートはP1またはP2のいずれか一方のみ使用可能です。現在両方のポートが使用されています`
    };
  }

  console.log(`  [checkMasterPortConstraint] OK (ポート数: ${usedPorts.size})`);
  return { met: true };
}

/**
 * Ethernet データ警告検証
 * FW ≤ 13 の場合、マスタ局が Ethernet 機器に接続するとき警告を発行
 * @param masterNode - マスタノード
 * @param maxFirmwareVersion - チェック対象の最大 FW バージョン
 * @returns 検証結果（met=false で警告）
 */
function checkEthernetDataWarning(
  masterNode: Node<FlowNodeData>,
  maxFirmwareVersion: number = 13
): InternalValidationResult {
  const firmwareVersion = masterNode.data.firmwareVersion;
  console.log(`  [checkEthernetDataWarning] マスタ: "${masterNode.data.label}", FW version: ${firmwareVersion}, maxFirmwareVersion: ${maxFirmwareVersion}`);

  // ファームウェアバージョンが制限値以下の場合は警告
  if (firmwareVersion !== undefined && firmwareVersion <= maxFirmwareVersion) {
    console.log(`  [checkEthernetDataWarning] FW version <= ${maxFirmwareVersion} → 警告を発行`);
    return {
      met: false,
      severity: 'warning',
      reason: `ファームウェアバージョンが${firmwareVersion}の場合、Ethernet機器にサイクリックデータが送信されるため、Ethernet機器によっては通信できないことがあります`
    };
  }

  console.log(`  [checkEthernetDataWarning] FW version > ${maxFirmwareVersion} → 警告なし`);
  return { met: true };
}

/**
 * 機能未対応チェック
 * 現バージョンで対応していない機能に対するエラーを返す
 * @param description - エラーメッセージ
 * @returns 検証結果
 */
function checkNotSupported(
  description: string
): InternalValidationResult {
  console.log(`  [checkNotSupported] 未対応機能: ${description}`);
  return {
    met: false,
    severity: 'error',
    reason: description
  };
}

/**
 * ファームウェアバージョン要件チェック
 * 指定されたminFirmwareVersion以上でない場合はエラー
 * @param masterNode - マスタノード
 * @param minFirmwareVersion - 必要な最小FWバージョン
 * @returns 検証結果
 */
function checkFirmwareVersionRequired(
  masterNode: Node<FlowNodeData>,
  minFirmwareVersion: number
): InternalValidationResult {
  const firmwareVersion = masterNode.data.firmwareVersion;
  
  // FWバージョンが未設定の場合は最新版とみなす（開発用）
  if (firmwareVersion === undefined) {
    console.log(`  [checkFirmwareVersionRequired] FW version undefined → 許可（開発モード）`);
    return { met: true };
  }
  
  // FWバージョンが要件を満たす場合
  if (firmwareVersion >= minFirmwareVersion) {
    console.log(`  [checkFirmwareVersionRequired] FW version ${firmwareVersion} >= ${minFirmwareVersion} → OK`);
    return { met: true };
  }
  
  // FWバージョンが不足している場合
  console.log(`  [checkFirmwareVersionRequired] FW version ${firmwareVersion} < ${minFirmwareVersion} → NG`);
  return {
    met: false,
    severity: 'error',
    reason: `この接続にはファームウェアバージョン${minFirmwareVersion}以上が必要です（現在: v${firmwareVersion}）`
  };
}

/**
 * マルチキャストフィルタ検証
 * パターン3,4,7,8（BA混合設定）でのマルチキャストフィルタ対応確認
 * @param node - 検証対象ノード
 * @returns 検証結果
 */
function checkMulticastFilter(node: Node<FlowNodeData>, nodes: Node<FlowNodeData>[]): InternalValidationResult {
  console.log(`  [checkMulticastFilter] ノード: ${node.data.label}, supportsMulticastFilter: ${node.data.supportsMulticastFilter}`);

  // ローカル局またはリモート局でない場合はスキップ
  if (node.data.stationType !== 'local' && node.data.stationType !== 'remote') {
    console.log(`  [checkMulticastFilter] スキップ (ノード種別: ${node.data.stationType})`);
    return { met: true };
  }

  const supportsMulticastFilter = node.data.supportsMulticastFilter;
  console.log(`  [checkMulticastFilter] supportsMulticastFilter値: ${supportsMulticastFilter}`);

  if (supportsMulticastFilter === true) {
    console.log(`  [checkMulticastFilter] OK: マルチキャストフィルタ対応`);
    return { met: true };
  } else if (supportsMulticastFilter === false) {
    console.log(`  [checkMulticastFilter] エラー: マルチキャストフィルタ非対応`);
    return { met: false, severity: 'error', reason: `デバイス局 "${node.data.label}" がマルチキャストフィルタに非対応です` };
  } else {
    console.log(`  [checkMulticastFilter] 警告: マルチキャストフィルタ未設定`);
    return { met: false, severity: 'warning', reason: `デバイス局 "${node.data.label}" のマルチキャストフィルタ設定が未設定です` };
  }
}

/**
 * 脚注 *1 チェック: 100Mbpsデバイス局が"低速"(LOW)に設定されているか確認
 * マスタが1Gで、100Mbpsのリモート局またはローカル局がいる場合に適用
 */
function checkFootnote1_CycleSetting(
  node: Node<FlowNodeData>,
  _otherNode: Node<FlowNodeData>,
  nodes: Node<FlowNodeData>[]
): { met: boolean; reason?: string; severity?: 'warning' | 'error' } {
  // 自ノードが100Mbpsデバイス局かどうかを確認
  if (node.data.speed !== '100M') {
    // 100Mbpsでなければチェック不要
    return { met: true };
  }

  // ローカル局またはリモート局かを確認
  if (node.data.stationType !== 'local' && node.data.stationType !== 'remote') {
    // デバイス局でなければチェック不要
    return { met: true };
  }

  // cycleSetting を確認
  const cycleSetting = node.data.cycleSetting;
  
  // cycleSetting を日本語に変換
  const cycleSettingMap: Record<string, string> = {
    'LOW': '低速',
    'MID': '中速',
    'BASIC': '基本周期'
  };
  const cycleSettingLabel = cycleSetting ? cycleSettingMap[cycleSetting] || cycleSetting : '未設定';
  
  if (cycleSetting === 'LOW') {
    return { met: true };
  } else if (!cycleSetting) {
    // 未設定の場合は警告
    return {
      met: false,
      severity: 'warning',
      reason: `通信速度100Mbpsのデバイス局 "${node.data.label}" の通信周期設定が未設定です`
    };
  } else {
    // 設定されているが LOW でない場合はエラー
    return {
      met: false,
      severity: 'error',
      reason: `通信速度100Mbpsのデバイス局 "${node.data.label}" の通信周期設定が"低速"に設定されていません (現在: ${cycleSettingLabel})`
    };
  }
}

/**
 * 脚注条件を確認して、不足していればALLOW_PENDINGエラーを返す
 */
function checkFootnotesAndValidate(
  nodeA: Node<FlowNodeData>,
  nodeB: Node<FlowNodeData>,
  cell: ConnectionTableCell,
  edgeId: string,
  nodes: Node<FlowNodeData>[],
  labelA: string,
  labelB: string,
  jsonTable?: import('@/types/connectionTable').ConnectionTable | null,
  cellData?: { status: string; switches?: string[]; conditions?: any[] } | null,
  edges?: Edge[]
): ValidationResult | null {
  const unmetFootnotes: Array<{ footnote: string; reason: string; severity?: 'warning' | 'error' }> = [];

  // マスタ局の速度を取得
  const masterNode = nodes.find(n => n.data.stationType === 'master');
  const masterSpeed = (masterNode?.data.speed || '1G') as '1G' | '100M';

  // **JSON の conditions から条件をチェック（優先）**
  console.log(`  [条件チェック開始前] cellData:`, cellData);
  if (cellData && cellData.conditions && cellData.conditions.length > 0) {
    console.log(`  [条件チェック] JSON から${cellData.conditions.length}個の条件を確認中...`);
    
    for (const condition of cellData.conditions) {
      if (condition.type === 'cycleSetting') {
        console.log(`  [条件チェック] cycleSetting を確認中... (requiredValue: ${condition.check?.requiredValue})`);
        
        // nodeB（遠い側）が100Mbpsかどうかで判定
        const checkB = checkCycleSettingByMasterSpeed(nodeB, masterSpeed, nodeA, nodes);
        const checkA = checkCycleSettingByMasterSpeed(nodeA, masterSpeed, nodeB, nodes);

        if (!checkB.met) {
          unmetFootnotes.push({
            footnote: '*1',
            reason: checkB.reason || 'cycleSetting チェック失敗',
            severity: checkB.severity || 'error'
          });
        }
        if (!checkA.met) {
          unmetFootnotes.push({
            footnote: '*1',
            reason: checkA.reason || 'cycleSetting チェック失敗',
            severity: checkA.severity || 'error'
          });
        }
      } else if (condition.type === 'multicastFilter') {
        console.log(`  [条件チェック] multicastFilter を確認中...`);
        
        const checkB = checkMulticastFilter(nodeB, nodes);
        const checkA = checkMulticastFilter(nodeA, nodes);

        if (!checkB.met) {
          unmetFootnotes.push({
            footnote: condition.check?.footnote || '*6',
            reason: checkB.reason || 'multicastFilter チェック失敗',
            severity: checkB.severity || 'error'
          });
        }
        if (!checkA.met) {
          unmetFootnotes.push({
            footnote: condition.check?.footnote || '*6',
            reason: checkA.reason || 'multicastFilter チェック失敗',
            severity: checkA.severity || 'error'
          });
        }
      } else if (condition.type === 'masterPortConstraint') {
        console.log(`  [条件チェック] masterPortConstraint を確認中...`);
        
        // マスタノードに対してのみチェック
        if (masterNode && edges) {
          const maxFirmwareVersion = condition.check?.maxFirmwareVersion || 11;
          const checkResult = checkMasterPortConstraint(masterNode, nodeA, nodes, edges, maxFirmwareVersion);
          if (!checkResult.met) {
            unmetFootnotes.push({
              footnote: '*3',
              reason: checkResult.reason || 'masterPortConstraint チェック失敗',
              severity: checkResult.severity || 'error'
            });
          }
        }
      } else if (condition.type === 'ethernetDataWarning') {
        console.log(`  [条件チェック] ========== ethernetDataWarning を確認中 ==========`);
        console.log(`  [条件チェック] condition.check:`, condition.check);
        
        // マスタノードに対してのみチェック
        if (masterNode) {
          const maxFirmwareVersion = condition.check?.maxFirmwareVersion || 13;
          console.log(`  [条件チェック] maxFirmwareVersion: ${maxFirmwareVersion}, masterNode: ${masterNode.data.label}`);
          const checkResult = checkEthernetDataWarning(masterNode, maxFirmwareVersion);
          console.log(`  [条件チェック] checkResult:`, checkResult);
          if (!checkResult.met) {
            unmetFootnotes.push({
              footnote: '*4',
              reason: checkResult.reason || 'ethernetDataWarning チェック失敗',
              severity: checkResult.severity || 'warning'
            });
          }
        }
      } else if (condition.type === 'notSupported') {
        console.log(`  [条件チェック] notSupported を確認中...`);
        
        const checkResult = checkNotSupported(condition.description);
        if (!checkResult.met) {
          unmetFootnotes.push({
            footnote: '*UNSUPPORTED',
            reason: checkResult.reason || condition.description,
            severity: checkResult.severity || 'error'
          });
        }
      } else if (condition.type === 'firmwareVersionRequired') {
        console.log(`  [条件チェック] firmwareVersionRequired を確認中...`);
        
        if (masterNode && condition.check?.minFirmwareVersion !== undefined) {
          const checkResult = checkFirmwareVersionRequired(masterNode, condition.check.minFirmwareVersion);
          if (!checkResult.met) {
            unmetFootnotes.push({
              footnote: '*FW',
              reason: checkResult.reason || 'ファームウェアバージョン不足',
              severity: checkResult.severity || 'error'
            });
          }
        }
      }
      // 他の condition types はここで追加
    }
  }

  // 注：Hard-coded テーブルの footnotes はメモ扱いで参照しない
  // 全ての条件は JSON の conditions に集約される
  // ただし、1Gマスタで100Mbps機器への接続の場合は、JSONが見つからなくても低速チェックを実行
  
  if (unmetFootnotes.length === 0 && !cellData?.conditions?.length) {
    // JSONのconditionsがない場合のフォールバック：1Gマスタ用の低速チェック
    if (masterSpeed === '1G') {
      console.log(`  [脚注チェック] JSONconditionsなし → 1Gマスタ用の低速チェックを実行`);
      const checkB = checkFootnote1_CycleSetting(nodeB, nodeA, nodes);
      const checkA = checkFootnote1_CycleSetting(nodeA, nodeB, nodes);

      if (!checkB.met) {
        unmetFootnotes.push({
          footnote: '*1',
          reason: checkB.reason || 'cycleSetting チェック失敗',
          severity: checkB.severity || 'error'
        });
      }
      if (!checkA.met) {
        unmetFootnotes.push({
          footnote: '*1',
          reason: checkA.reason || 'cycleSetting チェック失敗',
          severity: checkA.severity || 'error'
        });
      }
    }
  }

  // 不足している脚注があれば結果を返す
  if (unmetFootnotes.length > 0) {
    // 最も重大度が高い severity を選ぶ（error > warning）
    const hasCritical = unmetFootnotes.some(uf => uf.severity === 'error');
    const unmetMessage = unmetFootnotes
      .map(uf => `${uf.reason}`)
      .join('\n');
    
    console.log(`  [脚注チェック] 未充足条件があります`);
    
    return {
      id: nanoid(),
      severity: hasCritical ? 'error' : 'warning',
      status: hasCritical ? 'DENY' : 'ALLOW_PENDING',
      message: `${labelA} → ${labelB} の接続には以下の設定が必要です`,
      nodeIds: [nodeA.id, nodeB.id],
      edgeIds: [edgeId],
      details: unmetMessage
    };
  }

  // 全脚注が充足していればOK
  console.log(`  [脚注チェック] 全脚注充足 → OK`);
  return null;
}

/**
 * ノードから接続表のキーを生成
 */
function getNodeKey(node: Node<FlowNodeData>): string {
  const stationType = node.data.stationType;
  const deviceClass = node.data.deviceClass || 'B'; // デフォルトはClass B
  const speed = node.data.speed || '1G'; // デフォルトは1G

  if (stationType === 'master') {
    return `master-${deviceClass}-${speed}`;
  } else if (stationType === 'local') {
    return `local-${deviceClass}-${speed}`;
  } else if (stationType === 'remote') {
    return `remote-${deviceClass}-${speed}`;
  } else if (stationType === 'ethernet-device') {
    return `ethernet-${speed}`;
  }

  return 'unknown';
}

/**
 * 通信モードとClass A有無に応じて接続表を選択
 */
function selectConnectionTable(
  masterSpeed: '1G' | '100M',
  communicationMode: 'unicast' | 'multicast',
  hasClassA: boolean
): Record<string, Record<string, ConnectionTableCell>> {
  let tableName = '';
  let table: Record<string, Record<string, ConnectionTableCell>>;
  
  // ユニキャストモード
  if (communicationMode === 'unicast') {
    if (hasClassA) {
      // Class B/A混在
      if (masterSpeed === '100M') {
        tableName = 'Class B/A混在 ユニキャスト 100Mbps';
        table = CONNECTION_TABLE_BA_UNICAST_100M;
      } else {
        tableName = 'Class B/A混在 ユニキャスト 1Gbps';
        table = CONNECTION_TABLE_BA_UNICAST_1G;
      }
    } else {
      // Class Bのみ
      if (masterSpeed === '100M') {
        tableName = 'Class Bのみ ユニキャスト 100Mbps';
        table = CONNECTION_TABLE_CLASSB_UNICAST_100M;
      } else {
        tableName = 'Class Bのみ ユニキャスト 1Gbps';
        table = CONNECTION_TABLE_CLASSB_UNICAST_1G;
      }
    }
  } else {
    // マルチキャストモード
    if (hasClassA) {
      // Class B/A混在
      if (masterSpeed === '100M') {
        tableName = 'Class B/A混在 マルチキャスト 100Mbps';
        table = CONNECTION_TABLE_BA_MULTICAST_100M;
      } else {
        tableName = 'Class B/A混在 マルチキャスト 1Gbps';
        table = CONNECTION_TABLE_BA_MULTICAST_1G;
      }
    } else {
      // Class Bのみ
      if (masterSpeed === '100M') {
        tableName = 'Class Bのみ マルチキャスト 100Mbps';
        table = CONNECTION_TABLE_CLASSB_MULTICAST_100M;
      } else {
        tableName = 'Class Bのみ マルチキャスト 1Gbps';
        table = CONNECTION_TABLE_CLASSB_MULTICAST_1G;
      }
    }
  }
  
  console.log(`[接続表選択] ${tableName} (マスタ: ${masterSpeed}, 通信モード: ${communicationMode}, Class A: ${hasClassA ? 'あり' : 'なし'})`);
  return table;
}

/**
 * 接続可否表に基づいて2ノード間の接続を検証
 */
export function validateConnection(
  node1: Node<FlowNodeData>,
  node2: Node<FlowNodeData>,
  edge: Edge,
  distances: Map<string, number>,
  communicationMode: 'unicast' | 'multicast',
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  masterJsonTable?: import('@/types/connectionTable').ConnectionTable | null
): ValidationResult | null {
  const pair = determineNearerAndFarther(node1, node2, distances);

  if (!pair) {
    // 距離が同じ or 計算できない場合はスキップ
    return null;
  }

  const { nearer, farther } = pair;
  const nearerKey = getNodeKey(nearer);
  const fartherKey = getNodeKey(farther);

  // マスタ局の速度、Class A有無、デバイスID を判定
  const masterNode = nodes.find(n => n.data.stationType === 'master');
  const masterSpeed = (masterNode?.data.speed || '1G') as '1G' | '100M';
  const hasClassA = hasClassADevices(nodes, edges);
  
  // JSON テーブルはパラメーターから受け取る（外部でプリロード済み）
  const jsonTable = masterJsonTable || null;

  // **1. JSON テーブルから優先的に cell を取得**
  let cellData: { status: string; switches?: string[]; conditions?: any[] } | null = null;
  if (jsonTable) {
    cellData = findCellFromJsonTable(jsonTable, nearerKey, fartherKey);
  }

  // **2. JSON になければ hard-coded テーブルにフォールバック**
  let cell: ConnectionTableCell | undefined;
  if (cellData) {
    // JSON から取得した場合、ConnectionTableCell 形式に変換
    cell = {
      symbol: cellData.status?.startsWith('ALLOW') ? '○' : cellData.status?.startsWith('ALLOW_VIA') ? '△' : '×',
      status: cellData.status as any,
      switchTypes: cellData.switches,
    };
  } else {
    // Hard-coded テーブルから取得
    const connectionTable = selectConnectionTable(masterSpeed, communicationMode, hasClassA);
    const row = connectionTable[nearerKey];
    if (row) {
      cell = row[fartherKey];
    }
  }

  // cell が見つからない場合
  if (!cell) {
    console.log(`[接続検証] ${nearerKey} → ${fartherKey}: 表に存在しない組み合わせ`);
    return null; // 表に存在しない組み合わせ
  }

  // ラベル生成（ログ用）
  const nearerLabel = nearer.data.stationNumber !== undefined 
    ? `No.${nearer.data.stationNumber}` 
    : nearer.data.label;
  const fartherLabel = farther.data.stationNumber !== undefined 
    ? `No.${farther.data.stationNumber}` 
    : farther.data.label;
  
  console.log(`[接続検証] ${nearerLabel}(${nearerKey}) → ${fartherLabel}(${fartherKey}): ${cell.status} (${cell.symbol})`);
  if (cell.footnotes && cell.footnotes.length > 0) {
    console.log(`  脚注: ${cell.footnotes.join(', ')}`);
  }
  if (cell.switchTypes && cell.switchTypes.length > 0) {
    console.log(`  スイッチ種別: ${cell.switchTypes.join(', ')}`);
  }

  // スイッチ経由の検証を実行（DENY以外のケース）
  if (cell.status !== 'DENY') {
    const switchCheckResult = validateWithSwitchCheck(
      nearer,
      farther,
      cell,
      edges, // 全エッジを渡す
      nodes,
      edge.id,
      jsonTable,  // JSON テーブルを渡す
      cellData    // JSON から取得した cell データを渡す
    );
    
    if (switchCheckResult) {
      return switchCheckResult;
    }
  }

  // DENY の場合はエラーを返す
  if (cell.status === 'DENY') {
    // JSONのconditionsから notSupported タイプのメッセージを取得
    const notSupportedCondition = cellData?.conditions?.find(c => c.type === 'notSupported');
    const message = notSupportedCondition?.description 
      ? notSupportedCondition.description
      : `${nearerLabel} → ${fartherLabel} の接続は禁止されています (${cell.symbol})`;
    const details = notSupportedCondition?.description
      ? '' // カスタムメッセージがある場合は details 不要
      : '構成上接続できません。接続可能にするには機器配置や速度の変更が必要です。';
    
    return {
      id: nanoid(),
      severity: 'error',
      status: 'DENY',
      message: message,
      nodeIds: [nearer.id, farther.id],
      edgeIds: [edge.id],
      details: details,
    };
  }

  // ALLOW の場合はnullを返す（問題なし）
  console.log(`  → OK: 接続可能`);
  return null;
}

/**
 * スイッチ経由の検証を行う
 * ALLOW系: パス上に不適切なスイッチがあればDENYに格下げ
 * ALLOW_VIA_SWITCH系: スイッチなしでWARNING、不適切なスイッチでDENYに格下げ
 */
function validateWithSwitchCheck(
  nodeA: Node<FlowNodeData>,
  nodeB: Node<FlowNodeData>,
  cell: ConnectionTableCell,
  edges: Edge[],
  nodes: Node<FlowNodeData>[],
  edgeId: string,
  jsonTable?: import('@/types/connectionTable').ConnectionTable | null,
  cellData?: { status: string; switches?: string[]; conditions?: any[] } | null
): ValidationResult | null {
  const labelA = nodeA.data.stationNumber !== undefined 
    ? `No.${nodeA.data.stationNumber}` 
    : nodeA.data.label;
  const labelB = nodeB.data.stationNumber !== undefined 
    ? `No.${nodeB.data.stationNumber}` 
    : nodeB.data.label;

  // パスを探索
  const path = findPath(nodeA, nodeB, edges, nodes);
  
  if (!path) {
    // パスが見つからない = 接続されていない
    console.log(`  [スイッチ検証] パスが見つかりません`);
    return {
      id: nanoid(),
      severity: 'error',
      status: 'DENY',
      message: `${labelA} → ${labelB} が接続されていません`,
      nodeIds: [nodeA.id, nodeB.id],
      edgeIds: [edgeId],
      details: 'ネットワーク上で経路が確立されていません。',
    };
  }

  // パス上のスイッチを取得（マスタ・ローカル・リモート・Ethernetデバイス以外）
  const switchesInPath = path.nodes.filter(n => 
    n.data.stationType?.startsWith('switch-')
  );
  
  console.log(`  [スイッチ検証] パス上のスイッチ数: ${switchesInPath.length}`);
  if (switchesInPath.length > 0) {
    const switchLabels = switchesInPath.map(sw => 
      `${sw.data.label}(${getSwitchType(sw)})`
    ).join(', ');
    console.log(`  [スイッチ検証] スイッチ: ${switchLabels}`);
  }

  // ケース1: ALLOW系（○や○S）
  if (cell.status === 'ALLOW' || cell.status === 'ALLOW_PENDING') {
    if (switchesInPath.length === 0) {
      // 直接接続 → OK
      console.log(`  [スイッチ検証] 直接接続 → OK`);
      
      // 脚注チェックを実行（条件があれば ALLOW でも ALLOW_PENDING でもチェック）
      if (cellData?.conditions?.length || cell.footnotes?.length) {
        return checkFootnotesAndValidate(
          nodeA,
          nodeB,
          cell,
          edgeId,
          nodes,
          labelA,
          labelB,
          jsonTable,
          cellData,
          edges
        );
      }
      
      return null; // 問題なし
    } else {
      // スイッチ経由の場合、種別チェック
      const invalidSwitches = switchesInPath.filter(sw => {
        const switchType = getSwitchType(sw);
        return !cell.switchTypes?.includes(switchType);
      });

      if (invalidSwitches.length > 0) {
        const invalidSwitchTypes = invalidSwitches.map(sw => 
          formatSwitchType(getSwitchType(sw))
        ).join(', ');
        const formattedSwitchTypes = cell.switchTypes?.map(formatSwitchType).join(', ') || 'なし';
        console.log(`  [スイッチ検証] 不適切なスイッチ検出 → DENY`);
        return {
          id: nanoid(),
          severity: 'error',
          status: 'DENY',
          message: `${labelA} → ${labelB} の経路に不適切なスイッチがあります (${cell.symbol})`,
          nodeIds: [nodeA.id, nodeB.id, ...invalidSwitches.map(sw => sw.id)],
          edgeIds: [edgeId],
          details: `不適切なスイッチ種別: ${invalidSwitchTypes}\n許可されたスイッチ種別: ${formattedSwitchTypes}`,
        };
      }

      console.log(`  [スイッチ検証] 適切なスイッチ経由 → OK`);
      
      // スイッチ経由の場合、JSONから条件を再取得（スイッチ経由用の条件があるため）
      const nearerKey = getNodeKey(nodeA);
      const fartherKey = getNodeKey(nodeB);
      const viaSwitchCellData = jsonTable ? findCellFromJsonTable(jsonTable, nearerKey, fartherKey) : null;
      
      // スイッチ経由でも条件チェックを実行（ALLOW/ALLOW_PENDINGの場合）
      if (viaSwitchCellData?.conditions?.length || cell.footnotes?.length) {
        console.log(`  [スイッチ検証] スイッチ経由だが条件チェックを実行`);
        return checkFootnotesAndValidate(
          nodeA,
          nodeB,
          cell,
          edgeId,
          nodes,
          labelA,
          labelB,
          jsonTable,
          viaSwitchCellData,
          edges
        );
      }
      
      return null; // 適切なスイッチ経由
    }
  }

  // ケース2: ALLOW_VIA_SWITCH系（△）
  if (cell.status === 'ALLOW_VIA_SWITCH' || cell.status === 'ALLOW_VIA_SWITCH_PENDING') {
    if (switchesInPath.length === 0) {
      // スイッチがない場合の処理
      let conditionError: ValidationResult | null = null;
      
      // 1. 条件チェックを実行（結果を保持）
      if (cell.status === 'ALLOW_VIA_SWITCH_PENDING' && (cellData?.conditions?.length || cell.footnotes?.length)) {
        console.log(`  [スイッチ検証] スイッチなし、条件チェックを実行`);
        conditionError = checkFootnotesAndValidate(
          nodeA,
          nodeB,
          cell,
          edgeId,
          nodes,
          labelA,
          labelB,
          jsonTable,
          cellData,
          edges
        );
      }
      
      // 2. スイッチ不足のエラー情報を準備
      const formattedSwitchTypes = cell.switchTypes?.map(formatSwitchType).join(', ') || 'なし';
      
      // 3. 両方のエラーがある場合は統合して返す
      if (conditionError) {
        console.log(`  [スイッチ検証] 条件エラーとスイッチ不足エラーを統合`);
        return {
          id: nanoid(),
          severity: 'error', // 条件エラーがある場合は error
          status: 'DENY', // 複数エラーは DENY として扱う
          message: `${labelA} → ${labelB} に複数の問題があります`,
          nodeIds: [nodeA.id, nodeB.id],
          edgeIds: [edgeId],
          details: `【条件エラー】\n${conditionError.details || conditionError.message}\n\n【接続エラー】\n産業用スイッチ経由が必要です (${cell.symbol})\n必要なスイッチ種別: ${formattedSwitchTypes}`,
        };                                                           
      }
      
      // 4. 条件エラーがない場合はスイッチ不足のみ → WARNING
      console.log(`  [スイッチ検証] スイッチなし → WARNING`);
      return {
        id: nanoid(),
        severity: 'warning',
        status: cell.status,
        message: `${labelA} → ${labelB} の接続には産業用スイッチ経由が必要です (${cell.symbol})`,
        nodeIds: [nodeA.id, nodeB.id],
        edgeIds: [edgeId],
        details: `必要なスイッチ種別: ${formattedSwitchTypes}`,
      };
    } else {
      // スイッチの種別チェック（不適切なスイッチを検出）
      const invalidSwitches = switchesInPath.filter(sw => {
        const switchType = getSwitchType(sw);
        return !cell.switchTypes?.includes(switchType);
      });

      if (invalidSwitches.length > 0) {
        const invalidSwitchTypes = invalidSwitches.map(sw => 
          formatSwitchType(getSwitchType(sw))
        ).join(', ');
        const formattedSwitchTypes = cell.switchTypes?.map(formatSwitchType).join(', ') || 'なし';
        console.log(`  [スイッチ検証] 不適切なスイッチ検出 → DENY`);
        return {
          id: nanoid(),
          severity: 'error',
          status: 'DENY',
          message: `${labelA} → ${labelB} の経路に不適切なスイッチがあります (${cell.symbol})`,
          nodeIds: [nodeA.id, nodeB.id, ...invalidSwitches.map(sw => sw.id)],
          edgeIds: [edgeId],
          details: `不適切なスイッチ種別: ${invalidSwitchTypes}\n許可されたスイッチ種別: ${formattedSwitchTypes}`,
        };
      }

      console.log(`  [スイッチ検証] 適切なスイッチ経由 → 脚注チェック実行`);
      
      // スイッチ経由の場合、JSONから条件を再取得（スイッチ経由用の条件があるため）
      const nearerKey = getNodeKey(nodeA);
      const fartherKey = getNodeKey(nodeB);
      const viaSwitchCellData = jsonTable ? findCellFromJsonTable(jsonTable, nearerKey, fartherKey) : null;
      
      // ALLOW_VIA_SWITCH_PENDING の場合は脚注チェックを実行（条件がある場合のみ）
      if (cell.status === 'ALLOW_VIA_SWITCH_PENDING' && (viaSwitchCellData?.conditions?.length || cell.footnotes?.length)) {
        return checkFootnotesAndValidate(
          nodeA,
          nodeB,
          cell,
          edgeId,
          nodes,
          labelA,
          labelB,
          jsonTable,
          viaSwitchCellData,
          edges
        );
      }
      
      // ALLOW_VIA_SWITCH（脚注なし）の場合はOK
      return null; // 適切なスイッチ経由でALLOWに昇格
    }
  }

  // ケース3: DENY（そのまま返す、スイッチチェック不要）
  if (cell.status === 'DENY') {
    // JSONのconditionsから notSupported タイプのメッセージを取得
    const notSupportedCondition = cellData?.conditions?.find(c => c.type === 'notSupported');
    const message = notSupportedCondition?.description 
      ? notSupportedCondition.description
      : `${labelA} → ${labelB} の接続は禁止されています (${cell.symbol})`;
    const details = notSupportedCondition?.description
      ? '' // カスタムメッセージがある場合は details 不要
      : '構成上接続できません。接続可能にするには機器配置や速度の変更が必要です。';
    
    return {
      id: nanoid(),
      severity: 'error',
      status: 'DENY',
      message: message,
      nodeIds: [nodeA.id, nodeB.id],
      edgeIds: [edgeId],
      details: details,
    };
  }

  // その他のステータス（想定外）
  return null;
}
