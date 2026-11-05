// SPDX-License-Identifier: Apache-2.0
/**
 * device-defaults.json から デバイス情報を取得するユーティリティ
 * 
 * CSV → JSON 自動生成パイプラインから得た唯一の真実の源
 * このモジュールを通じてのみデバイス情報を参照することで、
 * CSVの更新が自動的にツール全体に反映される
 */

import deviceDefaultsJson from '../data/device-defaults.json';

// JSON データをアクセス可能にする
const jsonData = deviceDefaultsJson;

// ============ 共通インターフェース ============

/** 全セクション共通フィールド */
export interface BaseDevice {
  deviceId: string;
  deviceName: string;
  category: string;
  defaultPortCount: number;
  minPorts: number;
  maxPorts: number;
  defaultPortType: 'ethernet' | 'optical';
  supportsOpticalPorts: boolean;
  firmwareVersion: string;
  protocolVersion: number;
  notes: string;
}

// ============ セクション別インターフェース ============

/** マスタ局デバイス */
export interface MasterDevice extends BaseDevice {
  defaultClass: 'A' | 'B';
  deviceClass: 'A' | 'B';
  maxStations: number;
  speed: '100M' | '1G';
  speedOptions: string[];
  supportsMulticastFilter: boolean;
  isRingCapable: boolean;
  hardwareVersion: string;
}

/** ローカル・リモート局デバイス */
export interface LocalRemoteDevice extends BaseDevice {
  defaultClass: 'A' | 'B';
  deviceClass: string; // 'A', 'B', 'A,B' など複数可能
  cyclicDataBytes: number;
  speed: '100M' | '1G';
  speedOptions: string[];
  supportsMulticastFilter: boolean;
  isRingCapable: boolean;
  cycleSetting: string;
}

/** スイッチデバイス */
export interface SwitchDevice extends BaseDevice {
  switchType: 'ClassB' | 'ClassA' | 'General';
}

/** Ethernet機器デバイス */
export interface EthernetDevice extends BaseDevice {
  speed: '100M' | '1G';
  speedOptions: string[];
}

/** 全デバイス型の統合型（互換性のため） */
export type DeviceRecord =
  | MasterDevice
  | LocalRemoteDevice
  | SwitchDevice
  | EthernetDevice;

/** JSON データ型 */
interface DeviceDefaultsJson {
  version: string;
  generatedAt: string;
  timestamp: number;
  master: {
    description: string;
    count: number;
    devices: MasterDevice[];
  };
  localRemote: {
    description: string;
    count: number;
    devices: LocalRemoteDevice[];
  };
  switch: {
    description: string;
    count: number;
    devices: SwitchDevice[];
  };
  ethernet: {
    description: string;
    count: number;
    devices: EthernetDevice[];
  };
}

// ============ セクション別取得関数（型安全） ============

/**
 * マスタ局デバイスを取得
 * @param deviceId デバイスID
 * @returns マスタ局デバイス、見つからない場合は null
 */
export function getMasterDevice(deviceId: string): MasterDevice | null {
  const jsonData = deviceDefaultsJson as unknown as DeviceDefaultsJson;
  return jsonData.master.devices.find(d => d.deviceId === deviceId) ?? null;
}

/**
 * ローカル・リモート局デバイスを取得
 * @param deviceId デバイスID
 * @returns ローカル・リモート局デバイス、見つからない場合は null
 */
export function getLocalRemoteDevice(
  deviceId: string
): LocalRemoteDevice | null {
  const jsonData = deviceDefaultsJson as unknown as DeviceDefaultsJson;
  return jsonData.localRemote.devices.find(d => d.deviceId === deviceId) ?? null;
}

/**
 * スイッチデバイスを取得
 * @param deviceId デバイスID
 * @returns スイッチデバイス、見つからない場合は null
 */
export function getSwitchDevice(deviceId: string): SwitchDevice | null {
  const jsonData = deviceDefaultsJson as unknown as DeviceDefaultsJson;
  return jsonData.switch.devices.find(d => d.deviceId === deviceId) ?? null;
}

/**
 * Ethernet機器デバイスを取得
 * @param deviceId デバイスID
 * @returns Ethernet機器デバイス、見つからない場合は null
 */
export function getEthernetDevice(deviceId: string): EthernetDevice | null {
  const jsonData = deviceDefaultsJson as unknown as DeviceDefaultsJson;
  return jsonData.ethernet.devices.find(d => d.deviceId === deviceId) ?? null;
}

/**
 * デバイスID から デバイス情報全体を取得（どのセクションか自動判定）
 * @param deviceId デバイスID
 * @returns デバイス情報、見つからない場合は null
 */
export function getDeviceDefaults(deviceId: string): DeviceRecord | null {
  // 4つのセクションから検索
  return (
    getMasterDevice(deviceId) ||
    getLocalRemoteDevice(deviceId) ||
    getSwitchDevice(deviceId) ||
    getEthernetDevice(deviceId) ||
    null
  );
}

// データ取得ヘルパー（同期版：キャッシュから）
function getJsonData(): DeviceDefaultsJson {
  return deviceDefaultsJson as unknown as DeviceDefaultsJson;
}

// アプリケーション初期化時にデータを読み込む
export function initializeDeviceDefaults(): Promise<void> {
  return Promise.resolve();
}

// ============ 汎用ヘルパー関数（便利用） ============

/**
 * デバイスID から デバイス名を取得
 * @param deviceId デバイスID
 * @returns デバイス名、見つからない場合は '不明'
 */
export function getDeviceName(deviceId: string): string {
  return getDeviceDefaults(deviceId)?.deviceName ?? '不明';
}

/**
 * デバイスID から 分類(カテゴリ)を取得
 * @param deviceId デバイスID
 * @returns 分類名、見つからない場合は 'その他'
 */
export function getCategory(deviceId: string): string {
  return getDeviceDefaults(deviceId)?.category ?? 'その他';
}

/**
 * デバイスID から デフォルトポート数を取得
 * @param deviceId デバイスID
 * @returns ポート数（デフォルト: 2）
 */
export function getDefaultPortCount(deviceId: string): number {
  return getDeviceDefaults(deviceId)?.defaultPortCount ?? 2;
}

/**
 * デバイスID から ポート数の範囲を取得
 * @param deviceId デバイスID
 * @returns { min, max, default } 見つからない場合は { min: 1, max: 8, default: 2 }
 */
export function getPortCountRange(deviceId: string): {
  min: number;
  max: number;
  default: number;
} {
  const device = getDeviceDefaults(deviceId);
  if (!device) {
    return { min: 1, max: 8, default: 2 };
  }
  return {
    min: device.minPorts,
    max: device.maxPorts,
    default: device.defaultPortCount,
  };
}

/**
 * デバイスID から デフォルトポート種別を取得
 * @param deviceId デバイスID
 * @returns ポート種別 ('ethernet' | 'optical')
 */
export function getDefaultPortType(deviceId: string): 'ethernet' | 'optical' {
  return getDeviceDefaults(deviceId)?.defaultPortType ?? 'ethernet';
}

/**
 * デバイスID から 光ポート対応状況を取得
 * @param deviceId デバイスID
 * @returns true = 光ポート対応, false = 非対応
 */
export function getSupportsOpticalPorts(deviceId: string): boolean {
  return getDeviceDefaults(deviceId)?.supportsOpticalPorts ?? false;
}

/**
 * デバイスID から 通信速度を取得（マスタ・ローカル・リモート・Ethernet）
 * @param deviceId デバイスID
 * @returns 速度 ('100M' | '1G') (デフォルト: '1G')
 */
export function getSpeed(deviceId: string): '100M' | '1G' {
  const device = getDeviceDefaults(deviceId);
  if (device && 'speed' in device && device.speed) {
    return device.speed;
  }
  return '1G';
}

/**
 * デバイスID から 利用可能な速度オプションを取得
 * @param deviceId デバイスID
 * @returns 速度オプションの配列 (デフォルト: ['100M', '1G'])
 */
export function getSpeedOptions(deviceId: string): string[] {
  const device = getDeviceDefaults(deviceId);
  if (device && 'speedOptions' in device && device.speedOptions) {
    return device.speedOptions;
  }
  return ['100M', '1G'];
}

/**
 * デバイスID から サイクリックデータサイズを取得 (ローカル・リモート局用)
 * @param deviceId デバイスID
 * @returns バイト数、見つからない場合は 0
 */
export function getCyclicDataBytes(deviceId: string): number {
  const device = getLocalRemoteDevice(deviceId);
  return device?.cyclicDataBytes ?? 0;
}

/**
 * デバイスID から デバイスクラスを取得
 * @param deviceId デバイスID
 * @returns 'A', 'B', 'A,B' など
 */
export function getDeviceClass(deviceId: string): string {
  const device = getDeviceDefaults(deviceId);
  if (device && 'deviceClass' in device) {
    return device.deviceClass;
  }
  return 'A';
}

/**
 * デバイスID から デフォルトクラスを取得
 * @param deviceId デバイスID
 * @returns 'A' | 'B'
 */
export function getDefaultClass(deviceId: string): 'A' | 'B' {
  const device = getDeviceDefaults(deviceId);
  if (device && 'defaultClass' in device) {
    return device.defaultClass;
  }
  return 'A';
}

/**
 * デバイスID から 最大接続局数を取得 (マスタ局用)
 * @param deviceId デバイスID
 * @returns 局数、見つからない場合は 0
 */
export function getMaxStations(deviceId: string): number {
  const device = getMasterDevice(deviceId);
  return device?.maxStations ?? 0;
}

/**
 * デバイスID から スイッチ種別を取得 (スイッチ用)
 * @param deviceId デバイスID
 * @returns スイッチ種別
 */
export function getSwitchType(deviceId: string): string {
  const device = getSwitchDevice(deviceId);
  return device?.switchType ?? '';
}

/**
 * デバイスID からクラス変更可能かどうかを判定
 * @param deviceId デバイスID
 * @returns true = クラス変更可能, false = 変更不可
 */
export function canChangeClass(deviceId: string): boolean {
  const deviceClass = getDeviceClass(deviceId);
  // 'A,B' ならクラス変更可能、'A' や 'B' なら変更不可
  return (deviceClass || '').includes(',');
}

/**
 * デバイスID から マルチキャスト転送禁止設定対応状況を取得
 * @param deviceId デバイスID
 * @returns true = 対応, false = 非対応
 */
export function getSupportsMulticastFilter(deviceId: string): boolean {
  const device = getDeviceDefaults(deviceId);
  if (device && 'supportsMulticastFilter' in device) {
    return device.supportsMulticastFilter;
  }
  return false;
}

/**
 * デバイスID から リング構成対応状況を取得
 * @param deviceId デバイスID
 * @returns true = 対応, false = 非対応
 */
export function getIsRingCapable(deviceId: string): boolean {
  const device = getDeviceDefaults(deviceId);
  if (device && 'isRingCapable' in device) {
    return device.isRingCapable;
  }
  return false;
}

/**
 * デバイスID から 備考を取得
 * @param deviceId デバイスID
 * @returns 備考テキスト
 */
export function getNotes(deviceId: string): string {
  return getDeviceDefaults(deviceId)?.notes ?? '';
}

// ============ 右クリック編集用パラメータ取得関数 ============

/**
 * デバイスID から ファームウェアバージョンのデフォルト値を取得
 * @param deviceId デバイスID
 * @returns ファームウェアバージョン、未設定の場合は空文字列
 */
export function getDefaultFirmwareVersion(deviceId: string): string | number {
  const device = getDeviceDefaults(deviceId);
  if (device && 'firmwareVersion' in device) {
    return device.firmwareVersion ?? '';
  }
  return '';
}

/**
 * デバイスID から プロトコルバージョンのデフォルト値を取得
 * @param deviceId デバイスID
 * @returns プロトコルバージョン ('1.0' | '2.0')、見つからない場合は '2.0'
 */
export function getDefaultProtocolVersion(deviceId: string): '1.0' | '2.0' {
  const device = getDeviceDefaults(deviceId);
  if (device && 'protocolVersion' in device && device.protocolVersion) {
    return device.protocolVersion === 1 ? '1.0' : '2.0';
  }
  return '2.0';
}

/**
 * デバイスID から ハードウェアバージョンのデフォルト値を取得 (マスタ・ローカル・リモート局用)
 * @param deviceId デバイスID
 * @returns ハードウェアバージョン、未設定の場合は空文字列
 */
export function getDefaultHardwareVersion(deviceId: string): string | number {
  const masterDevice = getMasterDevice(deviceId);
  if (masterDevice && 'hardwareVersion' in masterDevice) {
    return (masterDevice.hardwareVersion as string | number) ?? '';
  }
  
  const lrDevice = getLocalRemoteDevice(deviceId);
  if (lrDevice && 'hardwareVersion' in lrDevice) {
    return (lrDevice.hardwareVersion as string | number) ?? '';
  }
  
  return '';
}

/**
 * デバイスID から マルチキャストフィルタ対応のデフォルト値を取得
 * @param deviceId デバイスID
 * @returns true = 対応, false = 非対応, undefined = 未定義
 */
export function getDefaultMulticastFilter(
  deviceId: string
): boolean | undefined {
  const device = getDeviceDefaults(deviceId);
  if (device && 'supportsMulticastFilter' in device) {
    return device.supportsMulticastFilter;
  }
  return undefined;
}

/**
 * デバイスID から リング対応のデフォルト値を取得
 * @param deviceId デバイスID
 * @returns true = 対応, false = 非対応, undefined = 未定義
 */
export function getDefaultRingCapable(
  deviceId: string
): boolean | undefined {
  const device = getDeviceDefaults(deviceId);
  if (device && 'isRingCapable' in device) {
    return device.isRingCapable;
  }
  return undefined;
}

/**
 * デバイスID から 周期設定のデフォルト値を取得 (ローカル・リモート局用)
 * @param deviceId デバイスID
 * @returns 周期設定 ('LOW' | 'MID' | 'BASIC')、見つからない場合は 'BASIC'
 */
export function getDefaultCycleSetting(
  deviceId: string
): 'LOW' | 'MID' | 'BASIC' | undefined {
  const device = getLocalRemoteDevice(deviceId);
  if (device && 'cycleSetting' in device && device.cycleSetting) {
    const setting = device.cycleSetting.toUpperCase();
    if (setting === 'LOW' || setting === 'MID' || setting === 'BASIC') {
      return setting as 'LOW' | 'MID' | 'BASIC';
    }
  }
  return undefined;
}

/**
 * デバイスID から RX・RWr・LB・LW設定合計バイト数のデフォルト値を取得 (ローカル・リモート局用)
 * @param deviceId デバイスID
 * @returns バイト数、見つからない場合は 0
 */
export function getDefaultCyclicDataBytes(deviceId: string): number {
  const device = getLocalRemoteDevice(deviceId);
  if (device && 'cyclicDataBytes' in device && device.cyclicDataBytes) {
    return device.cyclicDataBytes;
  }
  return 0;
}

// ============ セクション別デバイス一覧 ============

/**
 * 指定セクションの全デバイスを取得
 * @param section セクション名
 * @returns デバイスレコードの配列
 */
export function getDevicesBySection(
  section: 'master'
): MasterDevice[];
export function getDevicesBySection(
  section: 'localRemote'
): LocalRemoteDevice[];
export function getDevicesBySection(
  section: 'switch'
): SwitchDevice[];
export function getDevicesBySection(
  section: 'ethernet'
): EthernetDevice[];
export function getDevicesBySection(section: string): DeviceRecord[] {
  switch (section) {
    case 'master':
      return jsonData.master.devices as any;
    case 'localRemote':
      return jsonData.localRemote.devices as any;
    case 'switch':
      return jsonData.switch.devices as any;
    case 'ethernet':
      return jsonData.ethernet.devices as any;
    default:
      return [];
  }
}

/**
 * 全マスタ局デバイスを取得
 * @returns マスタ局デバイスの配列
 */
export function getAllMasterDevices(): MasterDevice[] {
  return jsonData.master.devices as any;
}

/**
 * 全ローカル・リモート局デバイスを取得
 * @returns ローカル・リモート局デバイスの配列
 */
export function getAllLocalRemoteDevices(): LocalRemoteDevice[] {
  return jsonData.localRemote.devices as any;
}

/**
 * 全スイッチデバイスを取得
 * @returns スイッチデバイスの配列
 */
export function getAllSwitchDevices(): SwitchDevice[] {
  return jsonData.switch.devices as any;
}

/**
 * 全Ethernet機器デバイスを取得
 * @returns Ethernet機器デバイスの配列
 */
export function getAllEthernetDevices(): EthernetDevice[] {
  return jsonData.ethernet.devices as any;
}

// ============ 汎用デバイス名マッピング ============

/**
 * 汎用デバイスIDから表示名を取得
 * @param deviceId - generic-* または switch-* 形式のデバイスID
 * @returns 表示名
 */
export function getGenericDeviceName(deviceId: string): string {
  // 汎用デバイス（generic-*）の場合、JSON から deviceName を取得
  if (deviceId.startsWith('generic-')) {
    // JSON から該当デバイスを検索（deviceId フィールドで検索）
    const device = jsonData.master.devices?.find((d: any) => d.deviceId === deviceId) ||
                   jsonData.localRemote.devices?.find((d: any) => d.deviceId === deviceId) ||
                   jsonData.switch.devices?.find((d: any) => d.deviceId === deviceId) ||
                   jsonData.ethernet.devices?.find((d: any) => d.deviceId === deviceId);
    
    if (device) {
      return device.deviceName;
    }
  }

  // ネットワーク機器（switch-*, ethernet-device）の場合、固定マッピング
  const networkDeviceNames: Record<string, string> = {
    'switch-classB': '産業用スイッチ（Class B対応）',
    'switch-classA': '産業用スイッチ（Class A対応）',
    'switch-general': '産業用スイッチ（汎用）',
    'ethernet-device': 'Ethernet機器',
  };
  
  return networkDeviceNames[deviceId] || deviceId;
}

// ============ 統計情報 ============

/**
 * 全デバイス情報の統計を取得
 * @returns 統計情報
 */
export function getDeviceStats() {
  return {
    master: jsonData.master.count,
    localRemote: jsonData.localRemote.count,
    switch: jsonData.switch.count,
    ethernet: jsonData.ethernet.count,
    total:
      jsonData.master.count +
      jsonData.localRemote.count +
      jsonData.switch.count +
      jsonData.ethernet.count,
    generatedAt: jsonData.generatedAt,
  };
}
