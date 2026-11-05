// SPDX-License-Identifier: Apache-2.0
import type { Node, Edge } from 'reactflow';

// 端末クラス / 速度は常にノード単位で保持
export type SpeedValue = '100M' | '1G';

// ポート種別
export type PortType = 'ethernet' | 'optical';

// ネットワークトポロジ種別
export type Topology = 'LINE' | 'STAR' | 'RING' | 'MIXED';

// 通信モード
export type CommunicationMode = 'unicast' | 'multicast';

// 局の種類: マスタ・ローカルユニット分類の機器はマスタ局またはローカ局、それ以外はリモート局
// スイッチやEthernet機器も含む
export type StationType = 
  | 'master'              // マスタ局
  | 'local'               // ローカル局
  | 'remote'              // リモート局
  | 'switch-classB'       // 産業用スイッチ（Class B対応）
  | 'switch-classA'       // 産業用スイッチ（Class A対応）
  | 'switch-general'      // 一般スイッチ
  | 'ethernet-device';    // Ethernet機器

export interface FlowNodeData {
  label: string;
  deviceClass?: 'A' | 'B';
  speed?: SpeedValue; // Mixed のとき個別指定。グローバルモード時も保持されるが無視。
  isMaster?: boolean; // マスタ局フラグ（ネットワーク内に1台のみ）
  stationType?: StationType; // 局の種類（マスタ/ローカル/リモート）
  deviceTypeDetailNormalized?: string; // デバイス分類名（CSPから取得）
  stationNumber?: number; // 局番 (マスタ局: 0固定, ローカル/リモート: 1-253)
  portCount?: number; // 1-8 (未指定は既定 2)
  portType?: PortType; // ポート種別（ethernet | optical）
  opticalPortCount?: number; // 光ポート数（スイッチのみ）
  ethernetPortCount?: number; // イーサネットポート数（スイッチのみ）
  
  // パラメータ（すべてオプショナル）
  // マスタ局のパラメータ
  cyclicDataBytes?: number; // サイクリックデータサイズ（バイト数）
  supportsMulticastFilter?: boolean; // マルチキャストフィルタ対応
  isRingCapable?: boolean; // リング対応可否
  firmwareVersion?: number; // ファームウェアバージョン（例: 11, 13, 14...）
  protocolVersion?: '1.0' | '2.0'; // プロトコルバージョン
  portsUsed?: 'single' | 'both'; // マスタポート使用状態
  hardwareVersion?: number; // ハードウェアバージョン
  maxStations?: number; // 最大接続局数（例: RJ71GN11-T2 = 121局）
  
  // ローカル/リモート局のパラメータ
  cycleSetting?: 'LOW' | 'BASIC' | 'MID'; // 周期設定(低速/基本周期/中速)
  RX?: number; // 受信サイクリックデータバイト数
  RWr?: number; // リモート書き込みサイクリックデータバイト数
  LB?: number; // ローカルブロードキャストサイクリックデータバイト数
  LW?: number; // ローカル書き込みサイクリックデータバイト数
  axisCount?: number; // 軸数（多軸一体サーボの場合、局数カウント時に使用）
  
  // スイッチノードのパラメータ
  forbiddenPortsConfigured?: Set<string>; // マルチキャスト転送禁止設定ポート
}

export interface FlowSerializable {
  nodes: Node[];
  edges: Edge[];
  version: number;
  updatedAt: string;
  communicationMode?: CommunicationMode; // 通信モード（互換性のためオプショナル）
  // 過去データ互換用フィールドは読み取り時に無視（deviceClassMode / speedMode など）
}

export interface HistoryState {
  nodes: Node[];
  edges: Edge[];
}
