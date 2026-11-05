// SPDX-License-Identifier: Apache-2.0
import type { Node, Edge } from 'reactflow';
import type { ValidationResult } from '@/types/validation';
import type { FlowNodeData } from '@/types/flow';

/**
 * Class B/A境界スイッチ制約チェック
 * 
 * Class BA混在時、マスタ側パスにClass Bスイッチが存在する場合、
 * Class B機器とClass A機器の境界スイッチもClass B対応である必要がある
 */
export function checkBABoundarySwitchConstraint(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): ValidationResult[] {
  const results: ValidationResult[] = [];

  console.log('[baBoundarySwitch] チェック開始');
  console.log(`[baBoundarySwitch] 全ノード数: ${nodes.length}, 全エッジ数: ${edges.length}`);
  console.log('[baBoundarySwitch] 全エッジ一覧:');
  edges.forEach(e => {
    const srcNode = nodes.find(n => n.id === e.source);
    const tgtNode = nodes.find(n => n.id === e.target);
    console.log(`  ${srcNode?.data.label || e.source} → ${tgtNode?.data.label || e.target}`);
  });

  // マスタ局を検索
  const masterNode = nodes.find(
    (n) => n.data.stationType === 'master' && n.data.deviceClass === 'B'
  );
  if (!masterNode) {
    console.log('[baBoundarySwitch] Class Bマスタが見つかりません');
    return results;
  }
  console.log(`[baBoundarySwitch] マスタ局: ${masterNode.data.label}`);

  // Class BA混在モードか確認
  const hasRemoteA = nodes.some(
    (n) => n.data.stationType === 'remote' && n.data.deviceClass === 'A'
  );
  if (!hasRemoteA) {
    console.log('[baBoundarySwitch] Class Aリモート局が存在しません（Class Bのみ）');
    return results; // Class Bのみの場合はチェック不要
  }
  console.log('[baBoundarySwitch] Class BA混在モード検出');

  // 全てのリモートAノードを取得
  const remoteANodes = nodes.filter(
    (n) => n.data.stationType === 'remote' && n.data.deviceClass === 'A'
  );
  console.log(`[baBoundarySwitch] リモートA局数: ${remoteANodes.length}`);
  
  // 全ノードのstationType/deviceClassを確認
  console.log('[baBoundarySwitch] 全ノード詳細:');
  nodes.forEach(n => {
    console.log(`  ${n.data.label}: stationType=${n.data.stationType}, deviceClass=${n.data.deviceClass}, id=${n.id}`);
  });

  // 各リモートAノードについて、接続する境界スイッチを検証
  for (const remoteANode of remoteANodes) {
    console.log(`[baBoundarySwitch] リモートA局をチェック: ${remoteANode.data.label}`);
    
    // リモートAノードに接続するエッジを取得（双方向）
    const connectedEdges = edges.filter(
      (e) => e.target === remoteANode.id || e.source === remoteANode.id
    );
    console.log(`[baBoundarySwitch] リモートA局への接続エッジ数: ${connectedEdges.length}`);

    for (const edge of connectedEdges) {
      // 接続相手のノードIDを取得
      const connectedNodeId = edge.target === remoteANode.id ? edge.source : edge.target;
      const sourceNode = nodes.find((n) => n.id === connectedNodeId);
      if (!sourceNode) continue;

      console.log(`[baBoundarySwitch] 入力元ノード: ${sourceNode.data.label} (stationType: ${sourceNode.data.stationType})`);

      // スイッチノードの場合のみチェック
      const isSwitchNode = 
        sourceNode.data.stationType === 'switch-classB' ||
        sourceNode.data.stationType === 'switch-classA' ||
        sourceNode.data.stationType === 'switch-general';
      
      if (!isSwitchNode) {
        console.log(`[baBoundarySwitch] スイッチではありません: ${sourceNode.data.label}`);
        continue;
      }
      console.log(`[baBoundarySwitch] スイッチノード検出: ${sourceNode.data.label}`);


      // このスイッチがClass B機器にも接続しているか確認（境界スイッチか）
      const switchConnectedEdges = edges.filter(
        (e) => e.target === sourceNode.id || e.source === sourceNode.id
      );
      console.log(`[baBoundarySwitch] スイッチへの接続エッジ数: ${switchConnectedEdges.length}`);
      console.log(`[baBoundarySwitch] スイッチID: ${sourceNode.id}`);
      
      // スイッチの接続先を確認
      switchConnectedEdges.forEach(e => {
        const connectedNodeId = e.source === sourceNode.id ? e.target : e.source;
        const connectedNode = nodes.find(n => n.id === connectedNodeId);
        console.log(`  接続先: ${connectedNode?.data.label || connectedNodeId}`);
      });
      
      const hasClassBConnection = switchConnectedEdges.some((e) => {
        const connectedNodeId = e.source === sourceNode.id ? e.target : e.source;
        const prevNode = nodes.find((n) => n.id === connectedNodeId);
        const isClassB = prevNode &&
          (prevNode.data.stationType === 'local' ||
            prevNode.data.stationType === 'remote' ||
            prevNode.data.stationType === 'master') &&
          prevNode.data.deviceClass === 'B';
        if (isClassB) {
          console.log(`[baBoundarySwitch] Class B機器接続検出: ${prevNode.data.label}`);
        }
        return isClassB;
      });

      if (!hasClassBConnection) {
        console.log(`[baBoundarySwitch] Class B機器に接続していません（境界スイッチではない）`);
        continue;
      }
      console.log(`[baBoundarySwitch] 境界スイッチ検出: ${sourceNode.data.label}`);

      // マスタの各ポートから境界スイッチへのパスを探索し、Class Bスイッチが存在するか確認
      const hasClassBSwitchInPath = checkClassBSwitchInPathToTarget(
        masterNode,
        sourceNode.id,
        nodes,
        edges
      );

      console.log(`[baBoundarySwitch] マスタから境界スイッチへのパスにClass Bスイッチ存在: ${hasClassBSwitchInPath}`);

      if (!hasClassBSwitchInPath) continue; // どのポートからもClass Bスイッチ経由で到達していない

      // 境界スイッチがClass B対応か確認
      const isClassBSwitch = sourceNode.data.stationType === 'switch-classB';
      console.log(`[baBoundarySwitch] 境界スイッチがClass B対応: ${isClassBSwitch}`);

      if (!isClassBSwitch) {
        console.log(`[baBoundarySwitch] 違反検出！境界スイッチがClass B対応ではありません`);
        
        // 違反: 境界スイッチがClass B対応ではない
        // スイッチの両側のエッジを収集（Class B側 → スイッチ, スイッチ → Class A側）
        const edgeIds: string[] = [];

        // Class B側の機器を特定（局番取得用）
        let classBStationNumber: number | undefined;
        let classBNodeLabel = '';
        
        // Class B側 ↔ スイッチ のエッジ（双方向）
        switchConnectedEdges.forEach((e) => {
          const connectedNodeId = e.source === sourceNode.id ? e.target : e.source;
          const prevNode = nodes.find((n) => n.id === connectedNodeId);
          if (
            prevNode &&
            (prevNode.data.stationType === 'local' ||
              prevNode.data.stationType === 'remote' ||
              prevNode.data.stationType === 'master') &&
            prevNode.data.deviceClass === 'B'
          ) {
            edgeIds.push(e.id);
            if (classBStationNumber === undefined) {
              classBStationNumber = prevNode.data.stationNumber;
              classBNodeLabel = prevNode.data.label;
            }
          }
        });

        // スイッチ ↔ Class A側 のエッジ
        edgeIds.push(edge.id);
        
        const classAStationNumber = remoteANode.data.stationNumber;
        const classANodeLabel = remoteANode.data.label;

        console.log(`[baBoundarySwitch] 赤色表示エッジ数: ${edgeIds.length}`);
        console.log(`[baBoundarySwitch] Class B側: No.${classBStationNumber} (${classBNodeLabel})`);
        console.log(`[baBoundarySwitch] Class A側: No.${classAStationNumber} (${classANodeLabel})`);

        // 局番が取得できている場合のメッセージ
        const stationInfo = 
          classBStationNumber !== undefined && classAStationNumber !== undefined
            ? `No.${classBStationNumber} → No.${classAStationNumber} への接続は産業用スイッチ (Class B対応) で接続する必要があります。`
            : 'Class B機器とClass A機器は、産業用スイッチ (Class B対応) で接続する必要があります。';

        results.push({
          id: `ba-boundary-switch-${sourceNode.id}-${remoteANode.id}`,
          severity: 'error',
          status: 'DENY',
          message: stationInfo,
          details: 'Class B/Aの境界よりマスタ側パスにClass B対応スイッチが存在するため、Class B/Aの境界もClass B対応スイッチにする必要があります。',
          nodeIds: [sourceNode.id],
          edgeIds,
        });
      }
    }
  }

  console.log(`[baBoundarySwitch] チェック完了。違反数: ${results.length}`);
  return results;
}

/**
 * マスタの各ポートから指定されたターゲットノードへのパスを探索し、
 * Class Bスイッチを経由しているかを判定
 * @param targetNodeId チェック対象のノードID（境界スイッチ）
 * @returns いずれかのポートからClass Bスイッチ経由で到達可能ならtrue
 */
function checkClassBSwitchInPathToTarget(
  masterNode: Node<FlowNodeData>,
  targetNodeId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): boolean {
  console.log(`[baBoundarySwitch] 各ポートからターゲットへのパス探索開始 (ターゲットID: ${targetNodeId})`);
  
  const portCount = masterNode.data.portCount || 2;
  
  // 各ポートについて独立して探索
  for (let portIndex = 0; portIndex < portCount; portIndex++) {
    const portNumber = portIndex + 1; // ポート番号は1始まり
    console.log(`[baBoundarySwitch] === ポート${portNumber}の探索開始 ===`);
    
    // このポートに接続されているエッジを取得
    const portEdges = edges.filter(e => {
      // マスタに接続されているエッジのみ
      if (e.source !== masterNode.id && e.target !== masterNode.id) {
        return false;
      }
      
      const handleId = (e.source === masterNode.id) ? e.sourceHandle : e.targetHandle;
      if (!handleId) return false;
      
      const match = handleId.match(/^port(\d+)_(in|out)$/);
      if (match) {
        const portNum = parseInt(match[1], 10);
        return portNum === portNumber;
      }
      return false;
    });
    
    console.log(`[baBoundarySwitch] ポート${portNumber}のエッジ数: ${portEdges.length}`);
    
    if (portEdges.length === 0) {
      console.log(`[baBoundarySwitch] ポート${portNumber}: 接続なし`);
      continue;
    }
    
    // このポートからBFSでターゲットノードに到達できるかチェック
    const visited = new Set<string>();
    const queue: string[] = [];
    let hasClassBSwitch = false;
    let hasDirectConnection = false; // このポートで直接接続があるか
    
    // ポートに接続されているノードを起点に追加
    for (const edge of portEdges) {
      const startNodeId = edge.source === masterNode.id ? edge.target : edge.source;
      
      // 起点ノードがターゲット自身の場合（マスタから境界スイッチへ直接接続）
      if (startNodeId === targetNodeId) {
        console.log(`[baBoundarySwitch] ポート${portNumber}: マスタから境界スイッチへ直接接続。Class Bスイッチ通過なし`);
        hasDirectConnection = true;
        // 直接接続の場合、起点には追加しないが、visitedにも追加しない
        // （Class Bスイッチ経由でマスタに戻ってきた時に、ここから到達できるようにするため）
        continue;
      }
      
      queue.push(startNodeId);
      visited.add(startNodeId);
      console.log(`[baBoundarySwitch] ポート${portNumber}: 起点ノードID: ${startNodeId}`);
    }
    
    // 起点がない場合（すべて直接接続だった）は次のポートへ
    if (queue.length === 0) {
      console.log(`[baBoundarySwitch] ポート${portNumber}: すべて直接接続のためBFSスキップ`);
      continue;
    }
    
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentNode = nodes.find((n) => n.id === currentId);
      
      console.log(`[baBoundarySwitch] ポート${portNumber}: 現在のノード: ${currentNode?.data.label || currentId}`);
      // ターゲットノードに到達したかチェック
      if (currentId === targetNodeId) {
        console.log(`[baBoundarySwitch] ポート${portNumber}: ターゲット到達！ Class Bスイッチ通過: ${hasClassBSwitch}`);
        if (hasClassBSwitch) {
          // このポート経由でClass Bスイッチを通過してターゲットに到達した
          console.log(`[baBoundarySwitch] ポート${portNumber}: Class Bスイッチ経由でターゲット到達（エラー条件）`);
          return true; // いずれかのポートでClass Bスイッチ経由で到達
        } else {
          // このポートから到達したがClass Bスイッチは通過しなかった
          console.log(`[baBoundarySwitch] ポート${portNumber}: Class Bスイッチなしでターゲット到達`);
          break; // このポートの探索は終了、次のポートへ
        }
      }
      
      // 現在のノードがClass Bスイッチか確認
      if (currentNode && currentNode.data.stationType === 'switch-classB') {
        console.log(`[baBoundarySwitch] ポート${portNumber}: Class Bスイッチ通過: ${currentNode.data.label}`);
        hasClassBSwitch = true;
      }
      
      // 隣接ノードを探索（双方向）
      const connectedEdges = edges.filter(
        (e) => {
          if (e.source !== currentId && e.target !== currentId) {
            return false; // このノードに接続していない
          }
          
          // 現在のノードがマスタの場合、このポート番号のエッジのみを使う
          if (currentId === masterNode.id) {
            // マスタのsourceHandleまたはtargetHandleのいずれかがこのポート番号か確認
            let isThisPort = false;
            
            // マスタが送信元の場合はsourceHandleをチェック
            if (e.source === masterNode.id && e.sourceHandle) {
              const match = e.sourceHandle.match(/^port(\d+)_(in|out)$/);
              if (match && parseInt(match[1], 10) === portNumber) {
                isThisPort = true;
              }
            }
            
            // マスタが受信先の場合はtargetHandleをチェック
            if (e.target === masterNode.id && e.targetHandle) {
              const match = e.targetHandle.match(/^port(\d+)_(in|out)$/);
              if (match && parseInt(match[1], 10) === portNumber) {
                isThisPort = true;
              }
            }
            
            return isThisPort;
          }
          
          return true; // マスタ以外は全エッジOK
        }
      );
      
      console.log(`[baBoundarySwitch] ポート${portNumber}: ノード${currentNode?.data.label || currentId}の隣接エッジ数: ${connectedEdges.length}`);
      
      for (const edge of connectedEdges) {
        const nextNodeId = edge.source === currentId ? edge.target : edge.source;
        
        if (!visited.has(nextNodeId)) {
          visited.add(nextNodeId);
          queue.push(nextNodeId);
        }
      }
    }
    
    if (queue.length > 0) {
      console.log(`[baBoundarySwitch] ポート${portNumber}: ターゲットに到達できませんでした`);
    }
  }
  
  console.log(`[baBoundarySwitch] 全ポート探索完了。Class Bスイッチ経由でのターゲット到達: なし`);
  return false; // どのポートからもClass Bスイッチ経由で到達していない
}
