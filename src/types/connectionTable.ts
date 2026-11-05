// SPDX-License-Identifier: Apache-2.0
/**
 * Connection Table - TSN構成チェック用の接続可否テーブルと脚注定義
 */

export interface ConditionCheck {
  footnoteId?: string;
  type: 'cycleSetting' | 'cyclicDataSize' | 'firmwareVersion' | 'multicastForbidden' | 'multicastFilter' | 'notSupported' | 'firmwareVersionRequired';
  description: string;
  check?: {
    /** ターゲットデバイス: '100MbpsRemote' | '100MbpsLocal' | 'all100Mbps' | 'all100MbpsRemote' など */
    targetDevices?: string;
    /** チェック対象パラメータ */
    parameter?: string;
    /** 期待値。値比較またはオブジェクト形式の複雑な条件 */
    requiredValue?: any;
    /** ファームウェアバージョンの最大値（この値以下で制約あり） */
    maxFirmwareVersion?: number;
    /** ファームウェアバージョンの最小値（この値以上で許可） */
    minFirmwareVersion?: number;
  };
}

export interface ConnectionCell {
  /** 行デバイス識別子 (例: "master-1G", "local-100M", "remote-1G") */
  from: string;
  /** 列デバイス識別子 */
  to: string;
  /** 接続ステータス: ALLOW | ALLOW_PENDING | ALLOW_VIA_SWITCH | ALLOW_VIA_SWITCH_PENDING | DENY */
  status: string;
  /** 利用可能なスイッチ種別 (例: ["S"] | ["S", "H", "N"]) */
  switches: string[];
  /** 適用される脚注ID (例: ["1", "3"]) */
  footnotes: string[];
  /** 脚注に紐づく条件チェック */
  conditions?: ConditionCheck[];
}

export interface ConnectionTable {
  /** マスタ速度 (1G | 100M) */
  masterSpeed: string;
  /** 通信モード (unicast | multicast) */
  mode: 'unicast' | 'multicast';
  /** 機器タイプ (units-only | units-ethernet) */
  deviceType: 'units-only' | 'units-ethernet';
  /** テーブルの行 */
  rows: ConnectionCell[];
  /** 脚注の定義 */
  footnotes: Record<
    string,
    {
      description: string;
      condition?: string;
    }
  >;
}

export interface MasterDeviceConnectionTables {
  version: number;
  generatedAt: string;
  masterDevice: string;
  /** マスタ局クラス (B_ONLY | BA_MIXED) */
  classification: 'B_ONLY' | 'BA_MIXED';
  /** トポロジ制約 (オプション) */
  topologyRestrictions?: Array<{
    topology: 'RING';
    description: string;
    minFirmwareVersion?: number;
  }>;
  /** テーブル群: [masterSpeed][mode][deviceType] */
  tables: {
    '1G'?: {
      unicast?: {
        'units-only'?: ConnectionTable;
        'units-ethernet'?: ConnectionTable;
      };
      multicast?: {
        'units-only'?: ConnectionTable;
        'units-ethernet'?: ConnectionTable;
      };
    };
    '100M'?: {
      unicast?: {
        'units-only'?: ConnectionTable;
        'units-ethernet'?: ConnectionTable;
      };
      multicast?: {
        'units-only'?: ConnectionTable;
        'units-ethernet'?: ConnectionTable;
      };
    };
  };
}
