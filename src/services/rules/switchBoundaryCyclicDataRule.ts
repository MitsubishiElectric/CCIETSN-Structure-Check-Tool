// SPDX-License-Identifier: Apache-2.0
import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../../types/flow';
import type { ValidationResult } from '../../types/validation';
import { nanoid } from 'nanoid';

/**
 * スイッチ境界のサイクリックデータ制約
 * 
 * 制約:
 * - マスタ局から見た一つ目のクラスB対応スイッチを境界とする
 * - 境界スイッチ以降のデバイス局のサイクリックデータ通信の合計が40KB以内
 * - 境界スイッチにEthernet機器が接続されている場合は8KB以内
 * - マスタ局が複数ポートの場合、各ポートごとに独立してチェック
 */

interface SwitchBoundaryInfo {
  switchNode: Node<FlowNodeData>;
  portPath: string[]; // マスタからスイッチまでの経路
  devicesAfter: Node<FlowNodeData>[]; // スイッチ以降のデバイス局
}

/**
 * マスタ局から特定のポート経路で最初のクラスB対応スイッチを検出
 */
function findFirstClassBSwitch(
  masterId: string,
  startNodeId: string, // マスタの隣接ノード
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  visited: Set<string> = new Set()
): { switchNode: Node<FlowNodeData>; path: string[] } | null {
  const queue: { nodeId: string; path: string[] }[] = [{ nodeId: startNodeId, path: [masterId, startNodeId] }];
  
  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    
    const node = nodes.find(n => n.id === nodeId);
    if (!node) continue;
    
    // クラスB対応スイッチを検出
    if (node.data.stationType === 'switch-classB') {
      return { switchNode: node, path };
    }
    
    // 次のノードへ探索（マスタ方向には戻らない）
    const nextEdges = edges.filter(e => 
      (e.source === nodeId && !path.includes(e.target)) ||
      (e.target === nodeId && !path.includes(e.source))
    );
    
    for (const edge of nextEdges) {
      const nextNodeId = edge.source === nodeId ? edge.target : edge.source;
      if (!visited.has(nextNodeId)) {
        queue.push({ nodeId: nextNodeId, path: [...path, nextNodeId] });
      }
    }
  }
  
  return null;
}

/**
 * スイッチに直接接続されているEthernet機器を検出
 */
function hasEthernetDeviceConnected(
  switchId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): boolean {
  const connectedEdges = edges.filter(e => e.source === switchId || e.target === switchId);
  
  for (const edge of connectedEdges) {
    const connectedNodeId = edge.source === switchId ? edge.target : edge.source;
    const connectedNode = nodes.find(n => n.id === connectedNodeId);
    
    if (connectedNode?.data.stationType === 'ethernet-device') {
      return true;
    }
  }
  
  return false;
}

/**
 * スイッチ以降のデバイス局を収集（マスタ方向を除く）
 */
function getDevicesAfterSwitch(
  switchId: string,
  pathToSwitch: string[], // マスタからスイッチまでの経路
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): Node<FlowNodeData>[] {
  const devices: Node<FlowNodeData>[] = [];
  // スイッチより前のノード（マスタ方向）のみをvisitedに追加
  // pathToSwitch = [マスタID, ..., スイッチID] なので、スイッチID以外をvisitedに入れる
  const visited = new Set<string>(pathToSwitch.slice(0, -1)); // スイッチより前まで
  const queue: string[] = [switchId];
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    
    const node = nodes.find(n => n.id === nodeId);
    if (!node) continue;
    
    // デバイス局（ローカル局 or リモート局）を収集
    if (node.data.stationType === 'local' || node.data.stationType === 'remote') {
      devices.push(node);
    }
    
    // 次のノードへ探索
    const nextEdges = edges.filter(e => 
      (e.source === nodeId && !visited.has(e.target)) ||
      (e.target === nodeId && !visited.has(e.source))
    );
    
    for (const edge of nextEdges) {
      const nextNodeId = edge.source === nodeId ? edge.target : edge.source;
      if (!visited.has(nextNodeId)) {
        queue.push(nextNodeId);
      }
    }
  }
  
  return devices;
}

/**
 * サイクリックデータ通信量を計算
 * 
 * 計算式:
 * totalSize = 256 + (146 × ローカル局数) + (106 × リモート局数) + Σ(cyclicDataBytes)
 */
function calculateCyclicDataSize(devices: Node<FlowNodeData>[]): {
  totalSize: number;
  localCount: number;
  remoteCount: number;
  baseSize: number;
  localOverhead: number;
  remoteOverhead: number;
  customDataSize: number;
} {
  const localCount = devices.filter(n => n.data.stationType === 'local').length;
  const remoteCount = devices.filter(n => n.data.stationType === 'remote').length;
  const baseSize = 256;
  const localOverhead = 146 * localCount;
  const remoteOverhead = 106 * remoteCount;
  const customDataSize = devices.reduce((sum, node) => {
    return sum + (node.data.cyclicDataBytes || 0);
  }, 0);
  
  const totalSize = baseSize + localOverhead + remoteOverhead + customDataSize;
  
  return {
    totalSize,
    localCount,
    remoteCount,
    baseSize,
    localOverhead,
    remoteOverhead,
    customDataSize
  };
}

/**
 * マスタ局の各ポート経路で一つ目のスイッチを検出
 */
function findSwitchBoundariesForMaster(
  masterNode: Node<FlowNodeData>,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): SwitchBoundaryInfo[] {
  const boundaries: SwitchBoundaryInfo[] = [];
  
  // マスタに直接接続されているノードを取得（各ポート経路の起点）
  const connectedEdges = edges.filter(e => e.source === masterNode.id || e.target === masterNode.id);
  const startNodes = connectedEdges.map(edge => 
    edge.source === masterNode.id ? edge.target : edge.source
  );
  
  // 各ポート経路ごとに独立して探索
  for (const startNodeId of startNodes) {
    const visited = new Set<string>();
    const result = findFirstClassBSwitch(masterNode.id, startNodeId, nodes, edges, visited);
    
    console.log(`[switchBoundary] 起点ノード: ${nodes.find(n => n.id === startNodeId)?.data.label || startNodeId}`);
    
    if (result) {
      console.log(`[switchBoundary] スイッチ検出: ${result.switchNode.data.label}, 経路: ${result.path.map(id => nodes.find(n => n.id === id)?.data.label || id).join(' → ')}`);
      const devicesAfter = getDevicesAfterSwitch(result.switchNode.id, result.path, nodes, edges);
      console.log(`[switchBoundary] スイッチ以降のデバイス: ${devicesAfter.map(d => d.data.label).join(', ')}`);
      
      boundaries.push({
        switchNode: result.switchNode,
        portPath: result.path,
        devicesAfter
      });
    } else {
      console.log(`[switchBoundary] スイッチ未検出`);
    }
  }
  
  return boundaries;
}

/**
 * スイッチ境界のサイクリックデータ制約チェック
 */
export function checkSwitchBoundaryCyclicDataRule(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): ValidationResult[] {
  const results: ValidationResult[] = [];
  
  // すべてのマスタ局を取得
  const masterNodes = nodes.filter(n => n.data.stationType === 'master');
  console.log(`[switchBoundary] マスタ局数: ${masterNodes.length}`);
  
  for (const masterNode of masterNodes) {
    console.log(`[switchBoundary] マスタ局 [${masterNode.data.label}] をチェック開始`);
    const boundaries = findSwitchBoundariesForMaster(masterNode, nodes, edges);
    console.log(`[switchBoundary] 検出された境界数: ${boundaries.length}`);
    
    for (const boundary of boundaries) {
      const { switchNode, portPath, devicesAfter } = boundary;
      console.log(`[switchBoundary] スイッチ [${switchNode.data.label}] の境界をチェック`);
      console.log(`[switchBoundary] スイッチ以降のデバイス局数: ${devicesAfter.length}`);
      
      if (devicesAfter.length === 0) {
        console.log(`[switchBoundary] デバイス局なし、スキップ`);
        continue; // デバイス局なし
      }
      
      // Ethernet機器の接続確認
      const hasEthernet = hasEthernetDeviceConnected(switchNode.id, nodes, edges);
      const limitBytes = hasEthernet ? 8 * 1024 : 40 * 1024; // 8KB or 40KB
      const limitKB = hasEthernet ? 8 : 40;
      console.log(`[switchBoundary] Ethernet機器接続: ${hasEthernet}, 制限: ${limitKB}KB (${limitBytes}B)`);
      
      // サイクリックデータサイズ計算
      const {
        totalSize,
        localCount,
        remoteCount,
        baseSize,
        localOverhead,
        remoteOverhead,
        customDataSize
      } = calculateCyclicDataSize(devicesAfter);
      
      console.log(`[switchBoundary] サイズ計算結果:`, {
        totalSize,
        localCount,
        remoteCount,
        baseSize,
        localOverhead,
        remoteOverhead,
        customDataSize,
        limitBytes,
        exceeded: totalSize > limitBytes
      });
      
      console.log(`[switchBoundary] デバイス詳細:`, devicesAfter.map(d => ({
        label: d.data.label,
        stationType: d.data.stationType,
        cyclicDataBytes: d.data.cyclicDataBytes
      })));
      
      // 制約チェック
      if (totalSize > limitBytes) {
        // エラー対象のエッジを特定（スイッチ → 最初のデバイスのエッジ）
        let edgeId = nanoid();
        
        if (devicesAfter.length > 0) {
          // スイッチに直接接続されているデバイスを探す
          const directDeviceEdge = edges.find(e => 
            (e.source === switchNode.id && devicesAfter.some(d => d.id === e.target)) ||
            (e.target === switchNode.id && devicesAfter.some(d => d.id === e.source))
          );
          
          if (directDeviceEdge) {
            edgeId = directDeviceEdge.id;
          }
        }
        
        const ethernetNote = hasEthernet 
          ? `スイッチにEthernet機器が接続されているため、制限は${limitBytes}B以下です。`
          : '';
        
        const firstLine = hasEthernet
          ? `マスタ局(${masterNode.data.label})から見た一つ目のスイッチ(${switchNode.data.label})以降のデバイス局のサイクリックデータサイズ合計が${limitBytes}Bを超えています。${ethernetNote}`
          : `マスタ局(${masterNode.data.label})から見た一つ目のスイッチ(${switchNode.data.label})以降のデバイス局のサイクリックデータサイズ合計が${limitBytes}Bを超えています。`;
        
        results.push({
          id: nanoid(),
          severity: 'error',
          status: 'DENY',
          edgeIds: [edgeId],
          message: `マスタ局側とデバイス局側の境界スイッチ以降のデバイス局側サイクリックデータサイズが上限を超えています`,
          details: 
            `${firstLine}\n` +
            `現在のサイズ: ${totalSize}B (基本: ${baseSize}B + ローカル${localCount}台: ${localOverhead}B + リモート${remoteCount}台: ${remoteOverhead}B + カスタムデータ: ${customDataSize}B)\n` +
            `制限: ${limitBytes}B以下\n\n` +
            `対象デバイス: ${devicesAfter.map(d => d.data.label).join(', ')}`
        });
      }
    }
  }
  
  return results;
}
