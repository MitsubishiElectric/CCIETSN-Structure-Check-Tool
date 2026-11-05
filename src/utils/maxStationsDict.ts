// SPDX-License-Identifier: Apache-2.0
/**
 * マスタ局の型名から最大接続局数を取得する辞書
 * 最大接続局数はマスタ局を含む総数（例: 121局 = マスタ局1 + デバイス局120）
 */

import deviceDefaultsJson from '../data/device-defaults.json';

export const maxStationsDict: Record<string, number> = {
  // FA統合コントローラ MELSEC MXコントローラ MX-Rモデル
  'MXR300-16': 254,
  'MXR300-32': 254,
  'MXR300-64': 254,
  'MXR500-128': 254,
  'MXR500-256': 254,

  // FA統合コントローラ MELSEC MXコントローラ MX-Fモデル
  'MXF100-8-N32': 39,
  'MXF100-8-P32': 39,
  'MXF100-16-N32': 47,
  'MXF100-16-P32': 47,

  // MELSEC iQ-Rシリーズ マスタ・ローカルユニット
  'RJ71GN11-T2': 121,
  'RJ71GN11-SX': 121,

  // MELSEC iQ-Rシリーズ CC-Link IE TSN Plusマスタ・ローカルユニット
  'RJ71GN11-EIP': 121,
  'RJ71GN11-EIP(T+E)': 121,

  // MELSEC iQ-Fシリーズ マスタ・ローカルユニット
  'FX5-CCLGN-MS': 61,

  // ネットワークインターフェースボード
  'NZ81GN11-SX': 121,
  'NZ81GN11-T2': 121,

  // MELSEC iQ-Rシリーズ モーションユニット
  'RD78G4': 121,
  'RD78G8': 121,
  'RD78G16': 121,
  'RD78G32': 121,
  'RD78G64': 121,
  'RD78GHV': 121,
  'RD78GHW': 121,

  // MELSEC iQ-Fシリーズ シンプルモーションユニット
  'FX5-40SSC-G': 21,
  'FX5-80SSC-G': 25,
};

/**
 * 型名から最大接続局数を取得
 * @param modelName 型名（例: "RJ71GN11-T2"）
 * @returns 最大接続局数、見つからない場合はundefined
 */
export function getMaxStations(modelName: string): number | undefined {
  if (!modelName) return undefined;
  
  // 型名を正規化: 前後の空白を削除、大文字に統一
  const normalized = modelName.trim();
  
  // Step 1: device-defaults.json から検索
  for (const section of [
    deviceDefaultsJson.master,
    deviceDefaultsJson.localRemote,
    deviceDefaultsJson.switch,
    deviceDefaultsJson.ethernet
  ]) {
    const device = section?.devices?.find(d => d.deviceId === normalized) as any;
    if (device && device.maxStations !== undefined) {
      return device.maxStations;
    }
  }
  
  // Step 2: 辞書のキーも大文字で検索（フォールバック）
  const normalizedUpper = normalized.toUpperCase();
  for (const [key, value] of Object.entries(maxStationsDict)) {
    if (key.toUpperCase() === normalizedUpper) {
      return value;
    }
  }
  
  return undefined;
}
