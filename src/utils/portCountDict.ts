// SPDX-License-Identifier: Apache-2.0
/**
 * ポート数管理辞書
 * 
 * 各機器のデフォルトポート数と変更可能範囲を定義します。
 * 参照順序:
 * 1. device-defaults.json (CSV 由来)
 * 2. PORT_COUNT_DICT (フォールバック用ハードコード)
 */

import deviceDefaultsJson from '../data/device-defaults.json';

export interface PortCountInfo {
  defaultPorts: number;
  editable: boolean;
  minPorts?: number; // editableがtrueの場合の最小値
  maxPorts?: number; // editableがtrueの場合の最大値
}

/**
 * ポート数辞書
 * key: 機器ID (stationType または 形名)
 */
export const PORT_COUNT_DICT: Record<string, PortCountInfo> = {
  // ===== ネットワーク機器 =====
  'switch-classB': { defaultPorts: 4, editable: true, minPorts: 1, maxPorts: 8 },
  'switch-classA': { defaultPorts: 4, editable: true, minPorts: 1, maxPorts: 8 },
  'switch-general': { defaultPorts: 4, editable: true, minPorts: 1, maxPorts: 8 },
  'ethernet-device': { defaultPorts: 1, editable: false },
  
  // ===== 汎用機器 =====
  'generic-master': { defaultPorts: 2, editable: true, minPorts: 1, maxPorts: 2 },
  'generic-local': { defaultPorts: 2, editable: true, minPorts: 1, maxPorts: 2 },
  'generic-remote': { defaultPorts: 2, editable: true, minPorts: 1, maxPorts: 2 },

  // ===== TSN対応製品 =====
  
  // --- マスタ・ローカルユニット ---
  'RJ71GN11-T2': { defaultPorts: 2, editable: false },
  'RJ71GN11-EIP(T)': { defaultPorts: 2, editable: false },
  'RJ71GN11-EIP(T+E)': { defaultPorts: 1, editable: false },
  'RJ71GN11-SX': { defaultPorts: 2, editable: false },

  // --- MXコントローラ ---
  'MXR300-16': { defaultPorts: 2, editable: false },
  'MXR300-32': { defaultPorts: 2, editable: false },
  'MXR300-64': { defaultPorts: 2, editable: false },
  'MXR500-128': { defaultPorts: 2, editable: false },
  'MXR500-256': { defaultPorts: 2, editable: false },
  'MXF100-8-N32': { defaultPorts: 2, editable: true, minPorts: 1, maxPorts: 2 },
  'MXF100-8-P32': { defaultPorts: 2, editable: true, minPorts: 1, maxPorts: 2 },
  'MXF100-16-N32': { defaultPorts: 2, editable: true, minPorts: 1, maxPorts: 2 },
  'MXF100-16-P32': { defaultPorts: 2, editable: true, minPorts: 1, maxPorts: 2 },

  // --- モーションユニット ---
  'RD78G4': { defaultPorts: 1, editable: false },
  'RD78G8': { defaultPorts: 1, editable: false },
  'RD78G16': { defaultPorts: 1, editable: false },
  'RD78G32': { defaultPorts: 1, editable: false },
  'RD78G64': { defaultPorts: 1, editable: false },
  'RD78GHV': { defaultPorts: 2, editable: false },
  'RD78GHW': { defaultPorts: 2, editable: false },
  'FX5-40SSC-G': { defaultPorts: 1, editable: false },
  'FX5-80SSC-G': { defaultPorts: 1, editable: false },

  // --- 汎用ACサーボ ---
  'MR-J5-G': { defaultPorts: 2, editable: false },
  'MR-J5-G-LL': { defaultPorts: 2, editable: false },
  'MR-J5-G-RJ': { defaultPorts: 2, editable: false },
  'MR-J5D1-G': { defaultPorts: 2, editable: false },
  'MR-J5D2-G': { defaultPorts: 2, editable: false },
  'MR-J5D3-G': { defaultPorts: 2, editable: false },
  'MR-J5W2-G': { defaultPorts: 2, editable: false },
  'MR-J5W3-G': { defaultPorts: 2, editable: false },

  // --- 汎用インバータ ---
  'FR-A800-F(-G)': { defaultPorts: 2, editable: false },
  'FR-A800-GN': { defaultPorts: 2, editable: false },
  'FR-E800-E': { defaultPorts: 2, editable: false },
  'FR-E800-SCE': { defaultPorts: 2, editable: false },
  'FR-F800-GN': { defaultPorts: 2, editable: false },

  // --- DC入力 ---
  'NZ2GN12A4-16D': { defaultPorts: 2, editable: false },
  'NZ2GN12A4-16DE': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-16D': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-32D': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-16D': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-32D': { defaultPorts: 2, editable: false },
  'NZ2GNCE3-32D': { defaultPorts: 2, editable: false },
  'NZ2GNCF1-32D': { defaultPorts: 2, editable: false },
  'NZ2GNSS2-8D': { defaultPorts: 2, editable: false },

  // --- トランジスタ出力 ---
  'NZ2GN12A2-16T': { defaultPorts: 2, editable: false },
  'NZ2GN12A2-16TE': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-16T': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-16TE': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-32T': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-32TE': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-16T': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-16TE': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-32T': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-32TE': { defaultPorts: 2, editable: false },
  'NZ2GNCF1-32T': { defaultPorts: 2, editable: false },
  'NZ2GNSS2-8TE': { defaultPorts: 2, editable: false },

  // --- 入出力混合 ---
  'NZ2GN12A42-16DT': { defaultPorts: 2, editable: false },
  'NZ2GN12A42-16DTE': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-32DT': { defaultPorts: 2, editable: false },
  'NZ2GN2B1-32DTE': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-32DT': { defaultPorts: 2, editable: false },
  'NZ2GN2S1-32DTE': { defaultPorts: 2, editable: false },
  'NZ2GNCE3-32DT': { defaultPorts: 2, editable: false },
  'NZ2GNS12A2-14DT': { defaultPorts: 2, editable: false },
  'NZ2GNS12A2-16DTE': { defaultPorts: 2, editable: false },
  'NZ2GNSS2-16DTE': { defaultPorts: 2, editable: false },

  // --- アナログ入力 ---
  'NZ2GN2B-60AD4': { defaultPorts: 2, editable: false },
  'NZ2GN2S-60AD4': { defaultPorts: 2, editable: false },

  // --- アナログ出力 ---
  'NZ2GN2B-60DA4': { defaultPorts: 2, editable: false },
  'NZ2GN2S-60DA4': { defaultPorts: 2, editable: false },

  // --- ブリッジユニット ---
  'NZ2AW1GNAL': { defaultPorts: 2, editable: false },
  'NZ2GN-GFB': { defaultPorts: 2, editable: false },

  // --- FPGAユニット ---
  'NZ2GN2S-D41D01': { defaultPorts: 2, editable: false },
  'NZ2GN2S-D41P01': { defaultPorts: 2, editable: false },
  'NZ2GN2S-D41PD02': { defaultPorts: 2, editable: false },

  // --- ネットワークインタフェースボード ---
  'NZ81GN11-SX': { defaultPorts: 2, editable: false },
  'NZ81GN11-T2': { defaultPorts: 2, editable: false },

  // --- エネルギー計測ユニット ---
  'EMU4-BD1A-MB': { defaultPorts: 1, editable: false },
  'EMU4-BM1-MB': { defaultPorts: 1, editable: false },
  'EMU4-CNT-MB': { defaultPorts: 1, editable: false },
  'EMU4-FD1-MB': { defaultPorts: 1, editable: false },
  'EMU4-HD1A-MB': { defaultPorts: 1, editable: false },
  'EMU4-HM1-MB': { defaultPorts: 1, editable: false },
  'EMU4-LG1-MB': { defaultPorts: 1, editable: false },

  // --- リニアトラック制御ユニット ---
  'MTR-SCU-G': { defaultPorts: 2, editable: false },
};

/**
 * 機器IDからポート数情報を取得
 * 参照順序: device-defaults.json → PORT_COUNT_DICT（フォールバック）
 * @param deviceId 機器ID (stationType または 形名)
 * @returns ポート数情報、存在しない場合は undefined
 */
export function getPortCountInfo(deviceId: string): PortCountInfo | undefined {
  // Step 1: device-defaults.json から検索
  for (const section of [
    deviceDefaultsJson.master,
    deviceDefaultsJson.localRemote,
    deviceDefaultsJson.switch,
    deviceDefaultsJson.ethernet
  ]) {
    const device = section?.devices?.find(d => d.deviceId === deviceId);
    if (device) {
      return {
        defaultPorts: device.defaultPortCount,
        editable: device.minPorts !== device.maxPorts,
        minPorts: device.minPorts,
        maxPorts: device.maxPorts
      };
    }
  }
  
  // Step 2: フォールバック - PORT_COUNT_DICT を参照
  return PORT_COUNT_DICT[deviceId];
}

/**
 * 機器IDのポート数が変更可能かどうかを判定
 * @param deviceId 機器ID (stationType または 形名)
 * @returns 変更可能な場合は true
 */
export function isPortCountEditable(deviceId: string): boolean {
  const info = getPortCountInfo(deviceId);
  return info?.editable ?? true; // 辞書にない場合はデフォルトで変更可能とする
}

/**
 * 機器IDのデフォルトポート数を取得
 * @param deviceId 機器ID (stationType または 形名)
 * @returns デフォルトポート数、存在しない場合は 2
 */
export function getDefaultPortCount(deviceId: string): number {
  const info = getPortCountInfo(deviceId);
  return info?.defaultPorts ?? 2; // 辞書にない場合はデフォルト2
}

/**
 * 機器IDの有効なポート数範囲を取得
 * @param deviceId 機器ID (stationType または 形名)
 * @returns { min, max } の範囲、editableでない場合は { min: default, max: default }
 */
export function getPortCountRange(deviceId: string): { min: number; max: number } {
  const info = getPortCountInfo(deviceId);
  if (!info || !info.editable) {
    const defaultPorts = info?.defaultPorts ?? 2;
    return { min: defaultPorts, max: defaultPorts };
  }
  return {
    min: info.minPorts ?? 1,
    max: info.maxPorts ?? 8,
  };
}

/**
 * 機器IDから光ケーブル対応状況を取得
 * @param deviceId 機器ID (stationType または 形名)
 * @returns { supportsOpticalPorts, defaultPortType }
 */
export function getOpticalPortInfo(deviceId: string): { supportsOpticalPorts: boolean; defaultPortType: 'ethernet' | 'optical' } {
  // Step 1: device-defaults.json から検索
  for (const section of [
    deviceDefaultsJson.master,
    deviceDefaultsJson.localRemote,
    deviceDefaultsJson.switch,
    deviceDefaultsJson.ethernet
  ]) {
    const device = section?.devices?.find(d => d.deviceId === deviceId);
    if (device) {
      return {
        supportsOpticalPorts: device.supportsOpticalPorts ?? false,
        defaultPortType: (device.defaultPortType === 'optical' ? 'optical' : 'ethernet')
      };
    }
  }
  
  // フォールバック: OPTICAL_PORT_MODELS で判定
  // 光ケーブル対応デバイスであれば defaultPortType は optical、supportsOpticalPorts は true
  return {
    supportsOpticalPorts: false,
    defaultPortType: 'ethernet'
  };
}
