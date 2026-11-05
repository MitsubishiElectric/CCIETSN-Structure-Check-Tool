// SPDX-License-Identifier: Apache-2.0
/**
 * Connection Table Loader - JSON から接続テーブルデータを読み込む
 */

import type { MasterDeviceConnectionTables, ConnectionTable } from '@/types/connectionTable';

const cache = new Map<string, MasterDeviceConnectionTables>();

/**
 * マスタ局の接続テーブルを読み込む
 * @param masterDeviceId マスタ局デバイスID (例: "RJ71GN11-T2")
 */
export async function loadConnectionTables(
  masterDeviceId: string
): Promise<MasterDeviceConnectionTables | null> {
  // キャッシュに存在すればそれを返す
  if (cache.has(masterDeviceId)) {
    return cache.get(masterDeviceId)!;
  }

  try {
    // Vite環境のベースURLを取得（相対パス対応）
    const baseUrl = (import.meta as any).env?.BASE_URL ?? './';
    const response = await fetch(
      `${baseUrl}data/connection-tables/${masterDeviceId}.json`
    );

    if (!response.ok) {
      console.warn(
        `Connection table not found for master device: ${masterDeviceId}`
      );
      return null;
    }

    const data: MasterDeviceConnectionTables = await response.json();
    cache.set(masterDeviceId, data);
    return data;
  } catch (error) {
    console.error(
      `Failed to load connection table for ${masterDeviceId}:`,
      error
    );
    return null;
  }
}

/**
 * マスタ局の特定条件のテーブルを取得
 * @param masterDeviceId マスタ局デバイスID
 * @param masterSpeed マスタ局速度 (1G | 100M)
 * @param mode 通信モード (unicast | multicast)
 * @param deviceType 機器タイプ (units-only | units-ethernet)
 * @param hasClassA Class A デバイスが存在するか (BA混在判定用)
 */
export async function getConnectionTable(
  masterDeviceId: string,
  masterSpeed: '1G' | '100M',
  mode: 'unicast' | 'multicast',
  deviceType: 'units-only' | 'units-ethernet',
  hasClassA: boolean = false
): Promise<ConnectionTable | null> {
  const tables = await loadConnectionTables(masterDeviceId);

  if (!tables) return null;

  console.log(`[接続テーブル] 読込開始: masterSpeed=${masterSpeed}, mode=${mode}, deviceType=${deviceType}, hasClassA=${hasClassA}`);
  console.log(`[接続テーブル] 利用可能なspeedKey: ${Object.keys(tables.tables).join(', ')}`);

  // hasClassA の場合は 1G-ba などの BA 混在用テーブルを使用
  const speedKey = hasClassA ? `${masterSpeed}-ba` : masterSpeed;
  console.log(`[接続テーブル] 選択speedKey: "${speedKey}"`);
  
  const speedTable = tables.tables[speedKey as keyof typeof tables.tables];
  
  if (!speedTable) {
    console.log(`[接続テーブル] speedKey="${speedKey}" のテーブルが見つかりません`);
    return null;
  }

  const modeTable = speedTable[mode];
  if (!modeTable) {
    console.log(`[接続テーブル] mode="${mode}" のテーブルが見つかりません`);
    return null;
  }

  const table = modeTable[deviceType];
  if (!table) {
    console.log(`[接続テーブル] deviceType="${deviceType}" のテーブルが見つかりません`);
    return null;
  }

  console.log(`[接続テーブル] 読込成功: speedKey="${speedKey}", mode="${mode}", deviceType="${deviceType}"`);
  return table;
}
