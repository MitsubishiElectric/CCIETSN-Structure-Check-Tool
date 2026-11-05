// SPDX-License-Identifier: Apache-2.0
import { Node, Edge } from 'reactflow';
import { FlowNodeData } from '../../types/flow';
import { NetworkValidationResult, ValidationResult } from '../../types/validation';
import { calculateDistancesFromMaster, getLogicalConnections, hasClassADevices, hasLoop, findLoopEdges, findAllLoopEdges } from './graphUtils';
import { validateConnection } from './connectionTableRule';
import { checkMaxStations } from './maxStationsRule';
import { checkMulticastSwitchPortConstraints } from './multicastSwitchPortRule';
import { checkBABoundarySwitchConstraint } from './baBoundarySwitchRule';
import { checkSwitchBoundaryCyclicDataRule } from './switchBoundaryCyclicDataRule';
import { checkMXR121StationsLimit } from './mxr121StationsRule';
import { detectTopology } from '../../utils/autoLayout';
import { getConnectionTable } from '../connectionTableLoader';
import { nanoid } from 'nanoid';

/**
 * 多軸機器の補足説明を生成（機器名でユニーク化）
 */
function buildMultiAxisNote(nodes: Node<FlowNodeData>[]): string {
  const multiAxisDevices = nodes.filter(n => (n.data?.axisCount ?? 1) > 1);
  
  if (multiAxisDevices.length === 0) return '';
  
  // 機器名とaxisCountでユニーク化
  const uniqueDeviceKeys = new Set<string>();
  const uniqueDevices: Array<{ label: string; axisCount: number }> = [];
  
  for (const node of multiAxisDevices) {
    const key = `${node.data?.label}:${node.data?.axisCount}`;
    if (!uniqueDeviceKeys.has(key)) {
      uniqueDeviceKeys.add(key);
      uniqueDevices.push({
        label: node.data?.label || '',
        axisCount: node.data?.axisCount ?? 1
      });
    }
  }
  
  const notes = uniqueDevices.map(({ label, axisCount }) => 
    `${label}(${axisCount}軸)は${axisCount}局としてカウントします`
  );
  
  return '\n\n※ ' + notes.join('\n※ ');
}

/**
 * RJ71GN11-T2・MXR の 1G↔100M 境界データサイズ制約をチェック
 * 制約: 100M側のClass B機器すべてのサイクリックデータサイズ合計が2048Bを超える接続はできない
 */
function checkCyclicDataSizeConstraint(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  masterDeviceLabel: string
): ValidationResult[] {
  const results: ValidationResult[] = [];
  
  // RJ71GN11-T2 または MXコントローラ 以外は対象外
  if (masterDeviceLabel !== 'RJ71GN11-T2' && !masterDeviceLabel.startsWith('MXR') && !masterDeviceLabel.startsWith('MXF')) {
    console.log(`[cyclicDataSize] マスタが RJ71GN11-T2 または MXコントローラ ではありません: ${masterDeviceLabel}`);
    return results;
  }
  
  const masterNode = nodes.find(n => n.data.stationType === 'master');
  if (!masterNode || masterNode.data.speed !== '1G') {
    console.log(`[cyclicDataSize] マスタが1Gではありません`, { masterSpeed: masterNode?.data.speed });
    return results; // マスタが1Gでない場合は対象外
  }
  
  console.log(`[cyclicDataSize] ${masterDeviceLabel} 1G マスタで制約チェック開始`);
  
  // 1G↔100M 境界の接続を検出
  // 直接エッジではなく、論理接続（スイッチ経由も含む）でチェック
  const logicalConnections = getLogicalConnections(nodes, edges);
  
  console.log(`[cyclicDataSize] 論理接続数: ${logicalConnections.length}`);
  logicalConnections.forEach((conn, idx) => {
    console.log(`[cyclicDataSize] 論理接続${idx}: ${conn.node1.data.label} → ${conn.node2.data.label}, path: ${conn.path.map(id => nodes.find(n => n.id === id)?.data.label || id).join(' → ')}`);
  });
  
  // 各論理接続パスで1G→100M境界を検出
  const boundaryConnections = new Map<string, { path: string[]; endNodeId: string }[]>(); // Map<1G_device_id, 境界情報>
  
  for (const { node1, node2, path } of logicalConnections) {
    console.log(`[cyclicDataSize] パス分析: ${node1.data.label} → ${node2.data.label}`);
    
    // パスを辿って1G→100M の速度遷移を検出
    // スイッチ等の speed=undefined ノードは透過的に扱う
    for (let i = 0; i < path.length - 1; i++) {
      const fromNodeId = path[i];
      let toNodeId = path[i + 1];
      
      let fromNode = nodes.find(n => n.id === fromNodeId);
      let toNode = nodes.find(n => n.id === toNodeId);
      
      if (!fromNode || !toNode) {
        console.log(`[cyclicDataSize] ノード不在: ${fromNodeId} or ${toNodeId}`);
        continue;
      }
      
      // toNodeの速度が未定義の場合、その先のノードまで透過的に探索
      let effectiveToNode = toNode;
      let j = i + 1;
      while (effectiveToNode && effectiveToNode.data.speed === undefined && j < path.length - 1) {
        j++;
        effectiveToNode = nodes.find(n => n.id === path[j]);
      }
      
      if (!effectiveToNode) continue;
      
      const fromSpeed = fromNode.data.speed;
      const toSpeed = effectiveToNode.data.speed;
      
      console.log(`[cyclicDataSize] ステップ${i}: ${fromNode.data.label}(${fromSpeed}) → ${effectiveToNode.data.label}(${toSpeed})`);
      
      // 1G → 100M の速度遷移を検出（スイッチ経由でもOK）
      if (fromSpeed === '1G' && toSpeed === '100M') {
        // 100M側がClass Bで、デバイス局の場合のみ対象
        console.log(`[cyclicDataSize] 1G→100M遷移検出! deviceClass=${effectiveToNode.data.deviceClass}, stationType=${effectiveToNode.data.stationType}`);
        if (effectiveToNode.data.deviceClass === 'B' && 
            (effectiveToNode.data.stationType === 'local' || effectiveToNode.data.stationType === 'remote')) {
          if (!boundaryConnections.has(fromNodeId)) {
            boundaryConnections.set(fromNodeId, []);
          }
          console.log(`[cyclicDataSize] 1G→100M境界検出 (スイッチ経由対応): ${fromNode.data.label} → ${effectiveToNode.data.label}`);
          boundaryConnections.get(fromNodeId)!.push({ path, endNodeId: effectiveToNode.id });
        }
      }
      
      // 100M → 1G の速度遷移を検出（逆方向）
      if (fromSpeed === '100M' && toSpeed === '1G') {
        if (fromNode.data.deviceClass === 'B' && 
            (fromNode.data.stationType === 'local' || fromNode.data.stationType === 'remote')) {
          if (!boundaryConnections.has(effectiveToNode.id)) {
            boundaryConnections.set(effectiveToNode.id, []);
          }
          console.log(`[cyclicDataSize] 100M→1G境界検出 (逆方向): ${fromNode.data.label} → ${effectiveToNode.data.label}`);
          boundaryConnections.get(effectiveToNode.id)!.push({ path, endNodeId: fromNodeId });
        }
      }
    }
  }
  
  console.log(`[cyclicDataSize] 検出された境界: ${boundaryConnections.size}件`);
  
  // 各境界接続について制約をチェック
  for (const [sourceNodeId, boundaryInfoList] of boundaryConnections) {
    const sourceNode = nodes.find(n => n.id === sourceNodeId);
    if (!sourceNode) continue;
    
    // マスタが1G側の場合は対象外（device-to-device 境界のみが対象）
    if (sourceNode.data.stationType === 'master') {
      console.log(`[cyclicDataSize] マスタが1G側のため制約対象外: ${sourceNode.data.label}`);
      continue;
    }
    
    // 同じ1G側ソースに対する全100M側デバイスを集約
    const deviceNodes: Node<FlowNodeData>[] = [];
    const visitedNodeIds = new Set<string>();
    const queue: string[] = [];
    
    // 全境界のendNodeIdから探索開始
    for (const { endNodeId } of boundaryInfoList) {
      queue.push(endNodeId);
    }
    
    // BFS で 100M側の下流ノードを探索
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visitedNodeIds.has(nodeId)) continue;
      visitedNodeIds.add(nodeId);
      
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;
      
      // 100M デバイス局のみを対象
      if (node.data.speed === '100M' && 
          (node.data.stationType === 'local' || node.data.stationType === 'remote')) {
        deviceNodes.push(node);
        console.log(`[cyclicDataSize] 100M側デバイス追加: ${node.data.label}`);
      }
      
      // 同じ速度の下流ノードを探索（別の速度への遷移は対象外）
      const childEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);
      for (const edge of childEdges) {
        const nextNodeId = edge.source === nodeId ? edge.target : edge.source;
        const childNode = nodes.find(n => n.id === nextNodeId);
        if (childNode && childNode.data.speed === '100M') {
          queue.push(nextNodeId);
        }
      }
    }
    
    if (deviceNodes.length === 0) continue;
    
    // データサイズ計算
    // 基本サイズ: 256B
    // ローカル局数: 各146B
    // リモート局数: 各106B
    // + 各デバイスのサイクリックデータサイズ
    
    const localCount = deviceNodes.filter(n => n.data.stationType === 'local').length;
    const remoteCount = deviceNodes.filter(n => n.data.stationType === 'remote').length;
    const baseSize = 256;
    const localOverhead = 146 * localCount;
    const remoteOverhead = 106 * remoteCount;
    const customDataSize = deviceNodes.reduce((sum, node) => {
      return sum + (node.data.cyclicDataBytes || 0);
    }, 0);
    
    const totalSize = baseSize + localOverhead + remoteOverhead + customDataSize;
    const maxSize = 2048;
    
    console.log(`[cyclicDataSize] サイズ計算: ${sourceNode.data.label} → 100M側`, {
      baseSize,
      localCount,
      localOverhead,
      remoteCount,
      remoteOverhead,
      customDataSize,
      totalSize,
      maxSize,
      exceeded: totalSize > maxSize
    });
    
    if (totalSize > maxSize) {
      // 100M側デバイスに接続されているすべてのエッジを取得
      const deviceNodeIds = new Set(deviceNodes.map(n => n.id));
      const affectedEdgeIds = edges
        .filter(e => deviceNodeIds.has(e.source) || deviceNodeIds.has(e.target))
        .map(e => e.id);
      
      results.push({
        id: nanoid(),
        severity: 'error',
        status: 'DENY',
        message: `1Gbps↔100Mbps境界のサイクリックデータサイズが上限を超えています`,
        nodeIds: [sourceNodeId, ...deviceNodes.map(n => n.id)],
        edgeIds: affectedEdgeIds,
        details: `マスタ(${sourceNode.data.label})から100Mbpsデバイス側へのサイクリックデータサイズ合計が2048Bを超えています。\n` +
          `現在のサイズ: ${totalSize}B (基本: ${baseSize}B + ローカル${localCount}台: ${localOverhead}B + リモート${remoteCount}台: ${remoteOverhead}B + カスタムデータ: ${customDataSize}B)\n` +
          `制限: ${maxSize}B以下\n\n` +
          `対象デバイス: ${deviceNodes.map(n => n.data.label).join(', ')}`
      });
    }
  }
  
  return results;
}

/**
 * RJ71GN11-T2 のプロトコルバージョン制約をチェック
 * 制約1: クラスB機器に1.0があり、クラスA機器が2.0のみ → BA境界のクラスA側サイクリックデータサイズ ≤ 2048B
 * 制約2: クラスA機器に1.0がある → 各ポート配下のクラスB機器 ≤ 8台 + BA境界のクラスA側サイクリックデータサイズ ≤ 2048B
 */
function checkProtocolVersionConstraint(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  masterDeviceLabel: string
): ValidationResult[] {
  const results: ValidationResult[] = [];
  
  // RJ71GN11-T2 または MXコントローラ 以外は対象外
  if (masterDeviceLabel !== 'RJ71GN11-T2' && !masterDeviceLabel.startsWith('MXR') && !masterDeviceLabel.startsWith('MXF')) {
    console.log(`[protocolVersion] マスタが RJ71GN11-T2 または MXコントローラ ではありません: ${masterDeviceLabel}`);
    return results;
  }
  
  // BA混在でない場合は対象外
  if (!hasClassADevices(nodes, edges)) {
    console.log(`[protocolVersion] Class A機器が存在しません（BA混在ではない）`);
    return results;
  }
  
  console.log(`[protocolVersion] RJ71GN11-T2 BA混在でプロトコルバージョン制約チェック開始`);
  
  // 全機器のプロトコルバージョンをログ出力
  nodes.forEach(n => {
    if (n.data.stationType === 'master' || n.data.stationType === 'local' || n.data.stationType === 'remote') {
      console.log(`[protocolVersion] ${n.data.label} (ID:${n.id.substring(0, 6)}): deviceClass=${n.data.deviceClass}, protocolVersion=${n.data.protocolVersion}`);
    }
  });
  
  // プロトコルバージョン未設定がある場合は対象外
  const hasUnsetProtocolVersion = nodes.some(n => 
    (n.data.stationType === 'master' || 
     n.data.stationType === 'local' || 
     n.data.stationType === 'remote') &&
    (n.data.protocolVersion === undefined || n.data.protocolVersion === '')
  );
  
  if (hasUnsetProtocolVersion) {
    console.log(`[protocolVersion] プロトコルバージョン未設定の機器があるため制約適用しません`);
    return results;
  }
  
  // クラスB機器に1.0があるか
  const hasClassBV1 = nodes.some(n => 
    n.data.deviceClass === 'B' && 
    (n.data.stationType === 'master' || n.data.stationType === 'local' || n.data.stationType === 'remote') &&
    n.data.protocolVersion === '1.0'
  );
  
  // クラスA機器に1.0があるか
  const hasClassAV1 = nodes.some(n => 
    n.data.deviceClass === 'A' && 
    (n.data.stationType === 'local' || n.data.stationType === 'remote') &&
    n.data.protocolVersion === '1.0'
  );
  
  console.log(`[protocolVersion] クラスBに1.0: ${hasClassBV1}, クラスAに1.0: ${hasClassAV1}`);
  
  // すべて2.0の場合はチェック不要
  if (!hasClassBV1 && !hasClassAV1) {
    console.log(`[protocolVersion] すべて2.0のため制約対象外`);
    return results;
  }
  
  const isPattern1 = hasClassBV1 && !hasClassAV1;  // クラスBのみ1.0
  const isPattern2 = hasClassAV1;  // クラスAに1.0あり
  
  console.log(`[protocolVersion] パターン1: ${isPattern1}, パターン2: ${isPattern2}`);
  
  // パターン2の場合: 各ポートから終端までのクラスB機器ホップ数チェック
  if (isPattern2) {
    const masterNode = nodes.find(n => n.data.stationType === 'master');
    if (masterNode) {
      const portCount = masterNode.data.portCount || 2;
      console.log(`[protocolVersion] パターン2: マスタのポート数 ${portCount}`);
      
      // マスタの各ポートに接続されているノードを探索
      const masterEdges = edges.filter(e => e.source === masterNode.id || e.target === masterNode.id);
      console.log(`[protocolVersion] マスタのエッジ数: ${masterEdges.length}`);
      
      for (let portIndex = 0; portIndex < portCount; portIndex++) {
        // このポートに直接接続されているノードを探索
        const portEdges = masterEdges.filter(e => {
          // マスタがソースの場合はsourceHandle、ターゲットの場合はtargetHandleをチェック
          const handleId = (e.source === masterNode.id) ? e.sourceHandle : e.targetHandle;
          if (!handleId) {
            return false; // ハンドル情報なしはスキップ
          }
          
          // ハンドルID形式: "port1_out", "port2_in" など
          const match = handleId.match(/^port(\d+)_(in|out)$/);
          if (match) {
            const portNum = parseInt(match[1], 10);
            console.log(`[protocolVersion] エッジ ${e.id}: handleId=${handleId}, portNum=${portNum}, チェック対象ポート=${portIndex + 1}`);
            return portNum === (portIndex + 1); // ポート番号は1始まり
          }
          return false;
        });
        
        console.log(`[protocolVersion] ポート${portIndex}のエッジ数: ${portEdges.length}`);
        
        // DFSで各経路のクラスBホップ数を計算
        const allPaths: Array<{ hops: number; edgeIds: string[] }> = [];
        
        // 各ポートエッジから開始
        for (const edge of portEdges) {
          const startNodeId = edge.source === masterNode.id ? edge.target : edge.source;
          
          // DFS関数: 現在のノードから終端までのクラスBホップ数と経路のエッジIDを計算
          const dfs = (
            nodeId: string, 
            currentHops: number, 
            visited: Set<string>,
            pathEdgeIds: string[]
          ): Array<{ hops: number; edgeIds: string[] }> => {
            if (visited.has(nodeId)) return [];
            
            const node = nodes.find(n => n.id === nodeId);
            if (!node) return [];
            
            visited.add(nodeId);
            
            // クラスBノード（機器またはスイッチ）ならホップ数を増やす
            let hops = currentHops;
            if (node.data.deviceClass === 'B') {
              hops++;
              console.log(`[protocolVersion] クラスBノード検出: ${node.data.label} (累計${hops}ホップ)`);
            }
            
            // 下流ノードを探索（双方向エッジを考慮、マスタに戻るエッジは除外）
            const childEdges = edges.filter(e => 
              (e.source === nodeId || e.target === nodeId) && 
              e.source !== masterNode.id && 
              e.target !== masterNode.id
            );
            
            // 未訪問の子ノードを取得
            const unvisitedChildren: Array<{ edge: Edge; nextNodeId: string }> = [];
            for (const edge of childEdges) {
              const nextNodeId = edge.source === nodeId ? edge.target : edge.source;
              if (!visited.has(nextNodeId)) {
                unvisitedChildren.push({ edge, nextNodeId });
              }
            }
            
            // 終端（未訪問の子ノードがない）ならこの経路の情報を返す
            if (unvisitedChildren.length === 0) {
              console.log(`[protocolVersion] 終端到達: ${node.data.label} (経路合計${hops}ホップ)`);
              return [{ hops, edgeIds: pathEdgeIds }];
            }
            
            // 各子ノードへの経路を収集
            const paths: Array<{ hops: number; edgeIds: string[] }> = [];
            for (const { edge, nextNodeId } of unvisitedChildren) {
              const childPaths = dfs(
                nextNodeId, 
                hops, 
                new Set(visited),
                [...pathEdgeIds, edge.id]
              );
              paths.push(...childPaths);
            }
            
            return paths;
          };
          
          const paths = dfs(startNodeId, 0, new Set(), [edge.id]);
          allPaths.push(...paths);
        }
        
        console.log(`[protocolVersion] ポート${portIndex}の全経路数: ${allPaths.length}`);
        
        // 8ホップを超える経路それぞれに対してエラーを生成
        const errorPaths = allPaths.filter(p => p.hops > 8);
        
        if (errorPaths.length > 0) {
          console.log(`[protocolVersion] ポート${portIndex}でエラーの経路数: ${errorPaths.length}`);
          
          // 各エラー経路に対して個別のエラーを追加
          for (const path of errorPaths) {
            results.push({
              id: nanoid(),
              severity: 'error',
              status: 'DENY',
              message: `マスタ局のポート${portIndex + 1}から終端までCC-Link IE TSN Class B機器（スイッチ含む）は8台までです`,
              nodeIds: [masterNode.id],
              edgeIds: path.edgeIds,
              details: `プロトコルバージョン1.0のCC-Link IE TSN Class A機器が存在するため、` +
                `マスタ局の各ポートから終端までの経路上でCC-Link IE TSN Class B機器（スイッチ含む）は8台までに制限されます。\n` +
                `現在の経路: ${path.hops}台`
            });
          }
        }
      }
    }
  }
  
  // BA境界のクラスA側サイクリックデータサイズチェック（パターン1、パターン2共通）
  const logicalConnections = getLogicalConnections(nodes, edges);
  
  console.log(`[protocolVersion] 論理接続数: ${logicalConnections.length}`);
  
  // クラスB ↔ クラスA の境界を検出（論理接続による重複を排除）
  const boundaryConnections = new Map<string, { path: string[]; endNodeId: string }[]>();
  const processedBoundaries = new Set<string>(); // デバイスペアの重複チェック用
  
  for (const { node1, node2, path } of logicalConnections) {
    console.log(`[protocolVersion] パス分析: ${node1.data.label} → ${node2.data.label}`);
    
    // パスを辿ってクラスB→クラスA の遷移を検出
    // スイッチ等の deviceClass=undefined ノードは透過的に扱う
    for (let i = 0; i < path.length - 1; i++) {
      const fromNodeId = path[i];
      let fromNode = nodes.find(n => n.id === fromNodeId);
      let toNode = nodes.find(n => n.id === path[i + 1]);
      
      if (!fromNode || !toNode) continue;
      
      // fromNodeのクラスが未定義の場合（スイッチ等）、手前のノードまで遡って探索
      let effectiveFromNode = fromNode;
      let k = i;
      while (effectiveFromNode && (!effectiveFromNode.data.deviceClass || effectiveFromNode.data.stationType?.startsWith('switch')) && k > 0) {
        k--;
        effectiveFromNode = nodes.find(n => n.id === path[k]);
      }
      
      // toNodeのクラスが未定義の場合（スイッチ等）、その先のノードまで透過的に探索
      let effectiveToNode = toNode;
      let j = i + 1;
      while (effectiveToNode && (!effectiveToNode.data.deviceClass || effectiveToNode.data.stationType?.startsWith('switch')) && j < path.length - 1) {
        j++;
        effectiveToNode = nodes.find(n => n.id === path[j]);
      }
      
      // 両方のノードにdeviceClassが必要かつスイッチでないこと
      if (!effectiveFromNode || !effectiveToNode) continue;
      if (!effectiveFromNode.data.deviceClass || !effectiveToNode.data.deviceClass) continue;
      if (effectiveFromNode.data.stationType?.startsWith('switch') || effectiveToNode.data.stationType?.startsWith('switch')) continue;
      
      const fromClass = effectiveFromNode.data.deviceClass;
      const toClass = effectiveToNode.data.deviceClass;
      
      console.log(`[protocolVersion] ステップ${i}: ${effectiveFromNode.data.label}(${fromClass}) → ${effectiveToNode.data.label}(${toClass})`);
      
      // クラスB → クラスA の遷移を検出
      if (fromClass === 'B' && toClass === 'A') {
        console.log(`[protocolVersion] B→A遷移検出! stationType=${effectiveToNode.data.stationType}`);
        if (effectiveToNode.data.stationType === 'local' || effectiveToNode.data.stationType === 'remote') {
          // 論理接続による重複を排除（デバイスペアでユニーク化）
          const pairKey = `${effectiveFromNode.id}->${effectiveToNode.id}`;
          if (processedBoundaries.has(pairKey)) {
            console.log(`[protocolVersion] 境界スキップ（重複）: ${effectiveFromNode.data.label} → ${effectiveToNode.data.label}`);
            continue;
          }
          processedBoundaries.add(pairKey);
          
          // 境界の起点は実際のデバイスノード（effectiveFromNode）にする
          const boundaryKey = effectiveFromNode.id;
          if (!boundaryConnections.has(boundaryKey)) {
            boundaryConnections.set(boundaryKey, []);
          }
          console.log(`[protocolVersion] B→A境界検出: ${effectiveFromNode.data.label} → ${effectiveToNode.data.label}`);
          boundaryConnections.get(boundaryKey)!.push({ path, endNodeId: effectiveToNode.id });
        }
      }
      
      // クラスA → クラスB の遷移を検出（逆方向）
      if (fromClass === 'A' && toClass === 'B') {
        if (effectiveFromNode.data.stationType === 'local' || effectiveFromNode.data.stationType === 'remote') {
          // 論理接続による重複を排除（デバイスペアでユニーク化）
          const pairKey = `${effectiveFromNode.id}->${effectiveToNode.id}`;
          if (processedBoundaries.has(pairKey)) {
            console.log(`[protocolVersion] 境界スキップ（重複、逆方向）: ${effectiveFromNode.data.label} → ${effectiveToNode.data.label}`);
            continue;
          }
          processedBoundaries.add(pairKey);
          
          const boundaryKey = effectiveToNode.id;
          if (!boundaryConnections.has(boundaryKey)) {
            boundaryConnections.set(boundaryKey, []);
          }
          console.log(`[protocolVersion] A→B境界検出 (逆方向): ${effectiveFromNode.data.label} → ${effectiveToNode.data.label}`);
          boundaryConnections.get(boundaryKey)!.push({ path, endNodeId: effectiveFromNode.id });
        }
      }
    }
  }
  
  console.log(`[protocolVersion] 検出された境界: ${boundaryConnections.size}件`);
  
  // 境界の詳細をログ出力
  for (const [sourceNodeId, boundaryInfoList] of boundaryConnections) {
    const sourceNode = nodes.find(n => n.id === sourceNodeId);
    console.log(`[protocolVersion] 境界: ${sourceNode?.data.label} (${boundaryInfoList.length}個の接続)`);
    boundaryInfoList.forEach((info, idx) => {
      const endNode = nodes.find(n => n.id === info.endNodeId);
      console.log(`[protocolVersion]   ${idx}: → ${endNode?.data.label}`);
    });
  }
  
  // 各境界接続について制約をチェック
  for (const [sourceNodeId, boundaryInfoList] of boundaryConnections) {
    const sourceNode = nodes.find(n => n.id === sourceNodeId);
    if (!sourceNode) continue;
    
    // クラスA側デバイスを集約
    const deviceNodes: Node<FlowNodeData>[] = [];
    const visitedNodeIds = new Set<string>();
    const queue: string[] = [];
    
    // 全境界のendNodeIdから探索開始
    for (const { endNodeId } of boundaryInfoList) {
      queue.push(endNodeId);
    }
    
    // BFS でクラスA側の下流ノードを探索
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visitedNodeIds.has(nodeId)) continue;
      visitedNodeIds.add(nodeId);
      
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;
      
      // クラスA デバイス局のみを対象
      if (node.data.deviceClass === 'A' && 
          (node.data.stationType === 'local' || node.data.stationType === 'remote')) {
        deviceNodes.push(node);
        console.log(`[protocolVersion] クラスA側デバイス追加: ${node.data.label}`);
      }
      
      // 同じクラスAの下流ノードを探索（双方向エッジを考慮）
      const childEdges = edges.filter(e => e.source === nodeId || e.target === nodeId);
      for (const edge of childEdges) {
        const nextNodeId = edge.source === nodeId ? edge.target : edge.source;
        const childNode = nodes.find(n => n.id === nextNodeId);
        if (childNode && childNode.data.deviceClass === 'A') {
          queue.push(nextNodeId);
        }
      }
    }
    
    if (deviceNodes.length === 0) continue;
    
    // データサイズ計算
    const localCount = deviceNodes.filter(n => n.data.stationType === 'local').length;
    const remoteCount = deviceNodes.filter(n => n.data.stationType === 'remote').length;
    const baseSize = 256;
    const localOverhead = 146 * localCount;
    const remoteOverhead = 106 * remoteCount;
    const customDataSize = deviceNodes.reduce((sum, node) => {
      return sum + (node.data.cyclicDataBytes || 0);
    }, 0);
    
    const totalSize = baseSize + localOverhead + remoteOverhead + customDataSize;
    const maxSize = 2048;
    
    console.log(`[protocolVersion] サイズ計算: ${sourceNode.data.label} → クラスA側`, {
      baseSize,
      localCount,
      localOverhead,
      remoteCount,
      remoteOverhead,
      customDataSize,
      totalSize,
      maxSize,
      exceeded: totalSize > maxSize
    });
    
    if (totalSize > maxSize) {
      // クラスA側デバイスに接続されているすべてのエッジを取得
      const deviceNodeIds = new Set(deviceNodes.map(n => n.id));
      const affectedEdgeIds = edges
        .filter(e => deviceNodeIds.has(e.source) || deviceNodeIds.has(e.target))
        .map(e => e.id);
      
      const patternMsg = isPattern1 
        ? 'プロトコルバージョン1.0のCC-Link IE TSN Class B機器が存在するため'
        : 'プロトコルバージョン1.0のCC-Link IE TSN Class A機器が存在するため';
      
      const multiAxisNote = buildMultiAxisNote(deviceNodes);
      
      results.push({
        id: nanoid(),
        severity: 'error',
        status: 'DENY',
        message: `CC-Link IE TSN Class BとCC-Link IE TSN Class Aの境界におけるCC-Link IE TSN Class A機器側すべてのデバイス局のサイクリックデータサイズ合計が2Kバイトを超える接続はできません`,
        nodeIds: [sourceNodeId, ...deviceNodes.map(n => n.id)],
        edgeIds: affectedEdgeIds,
        details: `${patternMsg}、BA境界のクラスA側サイクリックデータサイズ合計が2048B以下に制限されます。\n` +
          `現在のサイズ: ${totalSize}B (基本: ${baseSize}B + ローカル${localCount}台: ${localOverhead}B + リモート${remoteCount}台: ${remoteOverhead}B + カスタムデータ: ${customDataSize}B)\n` +
          `制限: ${maxSize}B以下\n\n` +
          `対象デバイス: ${deviceNodes.map(n => n.data.label).join(', ')}${multiAxisNote}`
      });
    }
  }
  
  return results;
}

/**
 * ネットワーク全体を検証
 */
export async function validateNetwork(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  communicationMode: 'unicast' | 'multicast' = 'unicast'
): Promise<NetworkValidationResult> {
  const results: ValidationResult[] = [];
  const checkedPairs = new Set<string>();

  // Phase 1: ネットワーク構造の基本検証
  
  // マスタ局の存在チェック
  const masterNode = nodes.find(n => n.data.stationType === 'master');
  if (!masterNode) {
    results.push({
      id: nanoid(),
      severity: 'error',
      status: 'DENY',
      message: 'マスタ局が存在しません',
      nodeIds: [],
      edgeIds: [],
    });
    return {
      valid: false,
      results,
      timestamp: Date.now(),
    };
  }

  // マスタ局の JSON テーブルをプリロード
  let masterJsonTable: import('@/types/connectionTable').ConnectionTable | null = null;
  const masterDeviceId = masterNode?.data.label;
  const masterSpeed = (masterNode?.data.speed || '1G') as '1G' | '100M';
  const hasClassA = hasClassADevices(nodes, edges);
  
  // MXコントローラでマルチキャストモードの場合は即座にエラーを返す
  if (masterDeviceId && (masterDeviceId.startsWith('MXR') || masterDeviceId.startsWith('MXF')) && communicationMode === 'multicast') {
    results.push({
      id: nanoid(),
      severity: 'error',
      status: 'DENY',
      message: 'MXコントローラはマルチキャストモードに対応していません',
      nodeIds: [masterNode.id],
      edgeIds: [],
      details: '',
    });
    return {
      valid: false,
      results,
      timestamp: Date.now(),
    };
  }

  // MXコントローラでリング構成がある場合は即座にエラーを返す（スイッチのみのリングは除外）
  const hasNetworkLoop = hasLoop(nodes, edges);
  if (masterDeviceId && (masterDeviceId.startsWith('MXR') || masterDeviceId.startsWith('MXF')) && hasNetworkLoop) {
    const allLoops = findAllLoopEdges(nodes, edges);
    
    // NGのリングのエッジIDを収集（スイッチのみのリングは除外）
    const invalidLoopEdgeIds: string[] = [];
    
    for (const loop of allLoops) {
      const loopNodes = nodes.filter(n => loop.nodeIds.includes(n.id));
      const allSwitches = loopNodes.length > 0 && loopNodes.every(n => n.data.stationType?.startsWith('switch'));
      
      // スイッチ以外を含むリングはNG
      if (!allSwitches) {
        invalidLoopEdgeIds.push(...loop.edgeIds);
      }
    }
    
    // NGのリングが1つでもあればエラー
    if (invalidLoopEdgeIds.length > 0) {
      results.push({
        id: nanoid(),
        severity: 'error',
        status: 'DENY',
        message: 'MXコントローラはリング構成に対応していません',
        nodeIds: [masterNode.id],
        edgeIds: invalidLoopEdgeIds,
        details: 'スイッチのみで構成されたリングは使用可能です',
      });
      return {
        valid: false,
        results,
        timestamp: Date.now(),
      };
    }
  }
  
  if (masterDeviceId) {
    try {
      masterJsonTable = await getConnectionTable(
        masterDeviceId,
        masterSpeed,
        communicationMode,
        'units-only',
        hasClassA
      );
      console.log(`[ネットワーク検証] マスタ "${masterDeviceId}" の JSON テーブルをロード (ClassA: ${hasClassA})`);
    } catch (error) {
      console.log(`[ネットワーク検証] マスタ "${masterDeviceId}" の JSON テーブルが見つかりません`);
    }
  }

  // Class B/A混在ネットワークでリング接続がある場合は即座にエラーを返す（スイッチのみのリングは除外）
  if (hasClassA && hasNetworkLoop) {
    const allLoops = findAllLoopEdges(nodes, edges);
    
    // NGのリングのエッジIDを収集（スイッチのみのリングは除外）
    const invalidLoopEdgeIds: string[] = [];
    
    for (const loop of allLoops) {
      const loopNodes = nodes.filter(n => loop.nodeIds.includes(n.id));
      const allSwitches = loopNodes.length > 0 && loopNodes.every(n => n.data.stationType?.startsWith('switch'));
      
      // スイッチ以外を含むリングはNG
      if (!allSwitches) {
        invalidLoopEdgeIds.push(...loop.edgeIds);
      }
    }
    
    // NGのリングが1つでもあればエラー
    if (invalidLoopEdgeIds.length > 0) {
      results.push({
        id: nanoid(),
        severity: 'error',
        status: 'DENY',
        message: 'Class B/A混在ネットワークではリング接続はできません',
        nodeIds: [],
        edgeIds: invalidLoopEdgeIds,
        details: 'リング接続を使用する場合は、Class B機器のみで構成してください。スイッチのみのリングは使用可能です',
      });
      return {
        valid: false,
        results,
        timestamp: Date.now(),
      };
    }
  }

  // リング構成 + スイッチ の制約チェック
  const hasSwitchNode = nodes.some(n => n.data.stationType?.startsWith('switch'));
  
  if (hasNetworkLoop && hasSwitchNode) {
    const allLoops = findAllLoopEdges(nodes, edges);
    
    // NGのリングのエッジIDを収集
    const invalidLoopEdgeIds: string[] = [];
    
    // 各リングをチェック
    for (const loop of allLoops) {
      // リングを構成するノードを取得
      const loopNodes = nodes.filter(n => loop.nodeIds.includes(n.id));
      
      // すべてスイッチかチェック
      const allSwitches = loopNodes.length > 0 && loopNodes.every(n => n.data.stationType?.startsWith('switch'));
      
      // スイッチ以外を含むリングはNG
      if (!allSwitches) {
        invalidLoopEdgeIds.push(...loop.edgeIds);
      }
    }
    
    // NGのリングが1つでもあればエラー
    if (invalidLoopEdgeIds.length > 0) {
      results.push({
        id: nanoid(),
        severity: 'error',
        status: 'DENY',
        message: 'スイッチはリング構成では使用できません',
        nodeIds: [],
        edgeIds: invalidLoopEdgeIds,
        details: 'リング構成では産業用スイッチを使用することができません',
      });
      return {
        valid: false,
        results,
        timestamp: Date.now(),
      };
    }
  }

  // Phase 2: 接続可否表による検証
  
  // マスタ局からの距離を計算
  const distances = calculateDistancesFromMaster(nodes, edges);

  // スイッチを経由した論理的な接続を取得
  const logicalConnections = getLogicalConnections(nodes, edges);

  // 論理的な接続を検証
  for (const { node1, node2, viaSwitch, path } of logicalConnections) {
    // 同じペアを重複チェックしないようにする
    const pairKey = [node1.id, node2.id].sort().join('-');
    if (checkedPairs.has(pairKey)) continue;
    checkedPairs.add(pairKey);

    // 接続可否表に基づく検証
    // エッジIDは経路上のエッジを含める
    const edgeIds: string[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const edge = edges.find(e => 
        (e.source === path[i] && e.target === path[i + 1]) ||
        (e.target === path[i] && e.source === path[i + 1])
      );
      if (edge) edgeIds.push(edge.id);
    }

    const result = validateConnection(node1, node2, { id: edgeIds[0] || nanoid() } as Edge, distances, communicationMode, nodes, edges, masterJsonTable);
    if (result && edgeIds.length > 0) {
      // エッジIDをすべて含める
      result.edgeIds = edgeIds;
      results.push(result);
    }
  }

  // 最大接続局数チェック（接続ルールチェックの後に実行）
  const maxStationsResult = checkMaxStations(nodes);
  if (maxStationsResult) {
    results.push(maxStationsResult);
  }

  // RJ71GN11-T2 固有制約: 1G↔100M 境界のサイクリックデータサイズチェック
  const cyclicDataResults = checkCyclicDataSizeConstraint(nodes, edges, masterDeviceId);
  results.push(...cyclicDataResults);

  // RJ71GN11-T2 固有制約: プロトコルバージョン制約チェック
  const protocolVersionResults = checkProtocolVersionConstraint(nodes, edges, masterDeviceId);
  results.push(...protocolVersionResults);

  // RJ71GN11-T2 マルチキャスト時のスイッチポート設定チェック
  const multicastSwitchPortResults = checkMulticastSwitchPortConstraints(nodes, edges, communicationMode);
  results.push(...multicastSwitchPortResults);

  // Class B/A境界スイッチ制約チェック
  const baBoundarySwitchResults = checkBABoundarySwitchConstraint(nodes, edges);
  results.push(...baBoundarySwitchResults);

  // スイッチ境界のサイクリックデータ制約チェック
  const switchBoundaryResults = checkSwitchBoundaryCyclicDataRule(nodes, edges);
  results.push(...switchBoundaryResults);

  // MXR 121局以上ライン接続制約チェック
  const mxr121StationsResult = checkMXR121StationsLimit(nodes, edges);
  if (mxr121StationsResult) {
    results.push(mxr121StationsResult);
  }

  // DENY が1つでもあれば invalid
  const hasError = results.some((r) => r.status === 'DENY');

  return {
    valid: !hasError,
    results,
    timestamp: Date.now(),
  };
}
