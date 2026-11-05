// SPDX-License-Identifier: Apache-2.0
/**
 * ポート種別判定
 * 光ケーブルポートを持つ機器の定義
 * 参照順序:
 * 1. device-defaults.json (CSV 由来)
 * 2. OPTICAL_PORT_MODELS (フォールバック用ハードコード)
 */

import deviceDefaultsJson from '../data/device-defaults.json';

export const OPTICAL_PORT_MODELS = [
  'RJ71GN11-SX',
  'NZ81GN11-SX'
] as const;

export type PortType = 'ethernet' | 'optical';

/**
 * 機器モデル名からポート種別を判定
 * 参照順序: device-defaults.json → OPTICAL_PORT_MODELS（フォールバック）
 * @param modelName 機器のモデル名（例: RJ71GN11-SX）
 * @returns 'optical' | 'ethernet'
 */
export function getPortType(modelName?: string): PortType {
  if (!modelName) return 'ethernet';
  
  // Step 1: device-defaults.json から検索
  for (const section of [
    deviceDefaultsJson.master,
    deviceDefaultsJson.localRemote,
    deviceDefaultsJson.switch,
    deviceDefaultsJson.ethernet
  ]) {
    const device = section?.devices?.find(d => d.deviceId === modelName);
    if (device) {
      return device.defaultPortType === 'optical' ? 'optical' : 'ethernet';
    }
  }
  
  // Step 2: フォールバック - OPTICAL_PORT_MODELS を参照
  return OPTICAL_PORT_MODELS.includes(modelName as any) ? 'optical' : 'ethernet';
}
