// SPDX-License-Identifier: Apache-2.0
import { nanoid } from 'nanoid';
import { Node, Edge } from 'reactflow';

import { FlowNodeData } from '../../types/flow';
import { ValidationResult } from '../../types/validation';

/**
 * MXRモデルのデバイスID一覧
 */
const MXR_MODELS = [
  'MXR300-16',
  'MXR300-32',
  'MXR300-64',
  'MXR500-128',
  'MXR500-256',
];

/**
 * 121局以上ライン接続対応機種の定義
 */
const SUPPORTED_DEVICES_121_STATIONS = {
  // ファームウェアバージョン10以降で対応
  firmwareV10: [
    'NZ2GN2S1-16D',
    'NZ2GN2S1-32D',
    'NZ2GN2B1-16D',
    'NZ2GN2B1-32D',
    'NZ2GNCF1-32D',
    'NZ2GNCE3-32D',
    'NZ2GN12A4-16D',
    'NZ2GN12A4-16DE',
    'NZ2GN2S1-16T',
    'NZ2GN2S1-32T',
    'NZ2GN2B1-16T',
    'NZ2GN2B1-32T',
    'NZ2GNCF1-32T',
    'NZ2GN12A2-16T',
    'NZ2GN2S1-16TE',
    'NZ2GN2S1-32TE',
    'NZ2GN2B1-16TE',
    'NZ2GN2B1-32TE',
    'NZ2GN12A2-16TE',
    'NZ2GN2S1-32DT',
    'NZ2GN2B1-32DT',
    'NZ2GNCE3-32DT',
    'NZ2GN12A42-16DT',
    'NZ2GN2S1-32DTE',
    'NZ2GN2B1-32DTE',
    'NZ2GN12A42-16DTE',
  ],
  
  // ファームウェアバージョン08以降で対応
  firmwareV08: [
    'NZ2GN2S-60AD4',
    'NZ2GN2B-60AD4',
    'NZ2GN2S-60DA4',
    'NZ2GN2B-60DA4',
  ],
  
  // ファームウェアバージョン00以降で対応（1Gbpsのみ）
  firmwareV00: [
    'MR-J5-G',
    'MR-J5-G-RJ',
    'MR-J5-G-LL',
    'MR-J5W2-G',
    'MR-J5W3-G',
  ],
};

/**
 * マスタ局の特定ポートに接続されているノードを取得（BFS）
 * @param masterNode マスタ局ノード
 * @param portName ポート名（例: "Port1", "Port2"）
 * @param nodes 全ノード
 * @param edges 全エッジ
 * @returns ポートに接続されているノードのリスト（マスタ自身は含まない）
 */
function getNodesConnectedToPort(
  masterNode: Node<FlowNodeData>,
  portName: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): Node<FlowNodeData>[] {
  console.log(`[MXR121 getNodes] ポート: ${portName}, マスタID: ${masterNode.id}`);
  console.log(`[MXR121 getNodes] 全エッジ数: ${edges.length}`);
  
  const connectedNodeIds = new Set<string>();
  const queue: string[] = [];
  
  // デバッグ: マスタに関連するエッジを表示
  const masterRelatedEdges = edges.filter(edge => 
    edge.source === masterNode.id || edge.target === masterNode.id
  );
  console.log(`[MXR121 getNodes] マスタ関連エッジ数: ${masterRelatedEdges.length}`);
  masterRelatedEdges.forEach(edge => {
    console.log(`  - source: ${edge.source}, sourceHandle: ${edge.sourceHandle}, target: ${edge.target}, targetHandle: ${edge.targetHandle}`);
  });
  
  // マスタの指定ポートに直接接続されているエッジを探す
  const directEdges = edges.filter(edge => {
    // マスタが送信元の場合
    if (edge.source === masterNode.id && edge.sourceHandle) {
      const match = edge.sourceHandle.match(/^port(\d+)_(in|out)$/);
      if (match && `Port${match[1]}` === portName) {
        return true;
      }
    }
    
    // マスタが受信先の場合
    if (edge.target === masterNode.id && edge.targetHandle) {
      const match = edge.targetHandle.match(/^port(\d+)_(in|out)$/);
      if (match && `Port${match[1]}` === portName) {
        return true;
      }
    }
    
    return false;
  });
  console.log(`[MXR121 getNodes] ${portName}直接接続エッジ数: ${directEdges.length}`);
  
  // 直接接続されているノードをキューに追加
  directEdges.forEach(edge => {
    const connectedId = edge.source === masterNode.id ? edge.target : edge.source;
    if (!connectedNodeIds.has(connectedId)) {
      connectedNodeIds.add(connectedId);
      queue.push(connectedId);
    }
  });
  
  // BFSで幹線上のすべてのノードを探索
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    
    // 現在のノードに接続されているエッジを探す
    const connectedEdges = edges.filter(edge => 
      edge.source === currentId || edge.target === currentId
    );
    
    connectedEdges.forEach(edge => {
      const neighborId = edge.source === currentId ? edge.target : edge.source;
      
      // マスタ局と既に訪問済みのノードはスキップ
      if (neighborId === masterNode.id || connectedNodeIds.has(neighborId)) {
        return;
      }
      
      connectedNodeIds.add(neighborId);
      queue.push(neighborId);
    });
  }
  
  return nodes.filter(node => connectedNodeIds.has(node.id));
}

/**
 * MXR 121局以上ライン接続制約チェック
 * 
 * 制約内容：
 * - MXRマスタの同一ポート幹線上で、Class B局が121局以上となる場合
 * - かつ、121局以上非対応のデバイスが1つでも含まれる場合
 * → エラー
 * 
 * 注意：
 * - Class A局はカウント対象外
 * - 多軸機器は軸数分カウント
 */
export function checkMXR121StationsLimit(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): ValidationResult | null {
  console.log('[MXR121] === チェック開始 ===');
  
  // マスタ局を取得
  const masterNode = nodes.find(n => n.data?.stationType === 'master');
  
  // マスタ局が存在しない場合はチェックをスキップ
  if (!masterNode) {
    console.log('[MXR121] マスタ局なし → スキップ');
    return null;
  }
  
  // マスタがMXRモデルでない場合はチェックをスキップ
  const deviceId = masterNode.data?.label || '';
  console.log(`[MXR121] マスタ: ${deviceId}`);
  if (!MXR_MODELS.includes(deviceId)) {
    console.log('[MXR121] MXRモデルではない → スキップ');
    return null;
  }
  
  // MXRの各ポートをチェック
  const portCount = masterNode.data?.portCount || 2;
  console.log(`[MXR121] ポート数: ${portCount}`);
  
  for (let portIndex = 1; portIndex <= portCount; portIndex++) {
    const portName = `Port${portIndex}`;
    console.log(`[MXR121] --- ${portName} チェック開始 ---`);
    
    // このポートに接続されているすべてのノードを取得
    const connectedNodes = getNodesConnectedToPort(masterNode, portName, nodes, edges);
    console.log(`[MXR121] ${portName} 接続ノード数: ${connectedNodes.length}`);
    
    // Class Bデバイスのみを抽出（スイッチを除外）
    const classBDevices = connectedNodes.filter(node => 
      node.data?.deviceClass === 'B' && 
      !node.data?.stationType?.startsWith('switch')
    );
    console.log(`[MXR121] ${portName} Class Bデバイス数: ${classBDevices.length}`);
    
    // 局数カウント（多軸機器は軸数分カウント）
    let classBCount = 0;
    classBDevices.forEach(node => {
      const axisCount = node.data?.axisCount || 1;
      classBCount += axisCount;
    });
    console.log(`[MXR121] ${portName} Class B局数（軸考慮）: ${classBCount}`);
    
    // 121局未満の場合はこのポートはOK
    if (classBCount < 121) {
      console.log(`[MXR121] ${portName} 121局未満 → OK`);
      continue;
    }
    
    console.log(`[MXR121] ${portName} 121局以上 → デバイスを分類`);
    
    // 121局以上の場合、デバイスを分類
    const errorDevices: Node<FlowNodeData>[] = []; // 対応リスト外 または FW入力済み && 基準未満
    const warningDevices: Node<FlowNodeData>[] = []; // 対応リスト内 && FW未入力、またはACサーボ
    
    classBDevices.forEach(node => {
      const nodeDeviceId = node.data?.label || '';
      const firmwareVersion = node.data?.firmwareVersion;
      
      console.log(`[MXR121] デバイス: ${nodeDeviceId}, FW: ${firmwareVersion}, 型: ${typeof firmwareVersion}, 厳密等価0: ${firmwareVersion === 0}, 厳密等価undefined: ${firmwareVersion === undefined}`);
      
      // デバイスが各対応リストに存在するかチェック
      const isInV10List = SUPPORTED_DEVICES_121_STATIONS.firmwareV10.includes(nodeDeviceId);
      const isInV08List = SUPPORTED_DEVICES_121_STATIONS.firmwareV08.includes(nodeDeviceId);
      const isInV00List = SUPPORTED_DEVICES_121_STATIONS.firmwareV00.includes(nodeDeviceId);
      
      // 対応リストにない機器 → 完全に非対応 → エラー
      if (!isInV10List && !isInV08List && !isInV00List) {
        errorDevices.push(node);
        console.log(`  → 対応リスト外のためエラー対象に追加`);
        return;
      }
      
      // ACサーボ（V00系）→ 常に警告（数値入力では正確な判定不可）
      if (isInV00List) {
        warningDevices.push(node);
        console.log(`  → ACサーボのため警告対象に追加`);
        return;
      }
      
      // V10/V08系：FW未入力 → 警告
      if (firmwareVersion === undefined || firmwareVersion === 0) {
        warningDevices.push(node);
        console.log(`  → 警告対象に追加`);
        return;
      }
      
      // V10/V08系：FW入力済みだが基準未満 → エラー
      if (!is121StationsSupportedWithVersion(nodeDeviceId, firmwareVersion)) {
        errorDevices.push(node);
        console.log(`  → FWバージョン不足のためエラー対象に追加`);
      }
    });
    
    // エラー対象がある場合 → エラー（赤）
    if (errorDevices.length > 0) {
      // デバイス名ごとに件数と局番を集計
      const deviceMap = new Map<string, { count: number; stationNumbers: number[] }>();
      errorDevices.forEach(node => {
        const name = node.data?.label || '不明なデバイス';
        const fw = node.data?.firmwareVersion !== undefined ? ` (FW: ${node.data.firmwareVersion})` : '';
        const key = `${name}${fw}`;
        const stationNumber = node.data?.stationNumber;
        
        if (!deviceMap.has(key)) {
          deviceMap.set(key, { count: 0, stationNumbers: [] });
        }
        const entry = deviceMap.get(key)!;
        entry.count++;
        if (stationNumber !== undefined) {
          entry.stationNumbers.push(stationNumber);
        }
      });
      
      // デバイス名: 件数 (局番: ...) の形式で表示
      const errorDeviceList = Array.from(deviceMap.entries())
        .map(([name, { count, stationNumbers }]) => {
          // 局番を昇順ソートして最大10個表示
          const sortedStations = stationNumbers.sort((a, b) => a - b);
          const displayStations = sortedStations.slice(0, 10).join(', ');
          const moreCount = sortedStations.length > 10 ? ` 他${sortedStations.length - 10}局` : '';
          const stationInfo = stationNumbers.length > 0 ? ` (局番: ${displayStations}${moreCount})` : '';
          return `${name}: ${count}件${stationInfo}`;
        })
        .join('\n');
      
      // 非対応デバイスに接続されているエッジを取得
      const errorNodeIds = new Set(errorDevices.map(n => n.id));
      const errorEdgeIds = edges
        .filter(edge => 
          errorNodeIds.has(edge.source) || errorNodeIds.has(edge.target)
        )
        .map(edge => edge.id);
      
      return {
        id: nanoid(),
        severity: 'error',
        status: 'DENY',
        message: `MXRの${portName}で121局以上のClass B局（${classBCount}局）が接続されていますが、121局以上非対応のデバイスが含まれています`,
        nodeIds: [masterNode.id, ...errorDevices.map(n => n.id)],
        edgeIds: errorEdgeIds,
        details: `121局以上非対応デバイス:\n${errorDeviceList}\n\n` +
                 `MX-Rモデルでは、121局以上のライン接続非対応デバイスが含まれる場合、` +
                 `同一ポートの幹線上でClass B局の合計が121局以上となる構成はできません。\n\n` +
                 `対策：\n` +
                 `1. 非対応デバイスのファームウェアを対応バージョンに更新する\n` +
                 `2. Class B局の数を121局未満にする\n` +
                 `3. 非対応デバイスを別のポートに配置する`,
      };
    }
    
    // エラー対象なし && 警告対象がある場合 → 警告（黄色）
    if (warningDevices.length > 0) {
      // デバイス名ごとに件数を集計
      const deviceCounts = new Map<string, number>();
      warningDevices.forEach(node => {
        const deviceName = node.data?.label || '不明なデバイス';
        deviceCounts.set(deviceName, (deviceCounts.get(deviceName) || 0) + 1);
      });
      
      // デバイス名: 件数 の形式で表示
      const warningDeviceList = Array.from(deviceCounts.entries())
        .map(([name, count]) => `${name}: ${count}件`)
        .join('\n');
      
      // ACサーボが含まれているかチェック
      const hasAcServo = warningDevices.some(node => 
        SUPPORTED_DEVICES_121_STATIONS.firmwareV00.includes(node.data?.label || '')
      );
      
      // ACサーボ用の追加説明
      const acServoNote = hasAcServo 
        ? `\n\nACサーボ（MR-J5シリーズ）の場合:\nファームウェアバージョンF0以降が必要です。F0以降であることを確認してください。`
        : '';
      
      return {
        id: nanoid(),
        severity: 'warning',
        status: 'ALLOW_PENDING',
        message: `MXRの${portName}で121局以上のClass B局（${classBCount}局）が接続されていますが、ファームウェアバージョンが未入力のデバイスがあります`,
        nodeIds: [masterNode.id, ...warningDevices.map(n => n.id)],
        edgeIds: [],
        details: `ファームウェアバージョン未入力:\n${warningDeviceList}\n\n` +
                 `MXRモデルで121局以上のライン接続を行う場合、デバイスのファームウェアバージョンによっては対応していない場合があります。${acServoNote}`,
      };
    }
    
    // すべてOK → このポートは問題なし
  }
  
  // すべてのポートで制約を満たしている場合
  console.log('[MXR121] すべてのポートでOK → null返却');
  return null;
}

/**
 * FWバージョン入力済みの場合の判定（内部用）
 */
function is121StationsSupportedWithVersion(deviceId: string, firmwareVersion: number): boolean {
  // ファームウェアバージョン0は未入力として扱う
  if (firmwareVersion === 0) {
    return false;
  }
  
  // ファームウェアバージョン10以降対応機種
  if (SUPPORTED_DEVICES_121_STATIONS.firmwareV10.includes(deviceId) && firmwareVersion >= 10) {
    return true;
  }
  
  // ファームウェアバージョン08以降対応機種
  if (SUPPORTED_DEVICES_121_STATIONS.firmwareV08.includes(deviceId) && firmwareVersion >= 8) {
    return true;
  }
  
  // ファームウェアバージョン00以降対応機種（1Gbpsのみ）
  if (SUPPORTED_DEVICES_121_STATIONS.firmwareV00.includes(deviceId) && firmwareVersion >= 0) {
    return true;
  }
  
  return false;
}
