// SPDX-License-Identifier: Apache-2.0
import { Node, Edge } from 'reactflow';
import { FlowNodeData } from '../../types/flow';

/**
 * マスタ局ノードを取得
 */
export function getMasterNode(nodes: Node<FlowNodeData>[]): Node<FlowNodeData> | null {
  return nodes.find((node) => node.data.stationType === 'master') || null;
}

/**
 * マスタ局から実際に接続されているノードを取得（BFS）
 * @returns マスタを含む到達可能なすべてのノード
 */
export function getReachableNodes(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): Node<FlowNodeData>[] {
  const masterNode = getMasterNode(nodes);

  if (!masterNode) {
    return []; // マスタ局がなければ空
  }

  const reachableIds = new Set<string>();
  const queue: string[] = [masterNode.id];
  reachableIds.add(masterNode.id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const neighbors = getConnectedNodes(currentId, nodes, edges);

    for (const neighbor of neighbors) {
      if (!reachableIds.has(neighbor.id)) {
        reachableIds.add(neighbor.id);
        queue.push(neighbor.id);
      }
    }
  }

  return nodes.filter((node) => reachableIds.has(node.id));
}

/**
 * ネットワーク内にClass A機器が存在するかを判定
 * マスタ局から実際に接続されているノード内で、Class Aのローカル局またはリモート局を確認
 */
export function hasClassADevices(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): boolean {
  const reachableNodes = getReachableNodes(nodes, edges);
  return reachableNodes.some(
    (node) =>
      node.data.deviceClass === 'A' &&
      (node.data.stationType === 'local' || node.data.stationType === 'remote')
  );
}

/**
 * 指定ノードに接続されているノードを取得
 */
export function getConnectedNodes(
  nodeId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): Node<FlowNodeData>[] {
  const connectedIds = new Set<string>();

  edges.forEach((edge) => {
    if (edge.source === nodeId) {
      connectedIds.add(edge.target);
    }
    if (edge.target === nodeId) {
      connectedIds.add(edge.source);
    }
  });

  return nodes.filter((node) => connectedIds.has(node.id));
}

/**
 * マスタ局からの距離をBFS（幅優先探索）で計算
 * @returns Map<ノードID, 距離>。マスタ局は距離0
 */
export function calculateDistancesFromMaster(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): Map<string, number> {
  const distances = new Map<string, number>();
  const masterNode = getMasterNode(nodes);

  if (!masterNode) {
    return distances; // マスタ局がなければ空のMapを返す
  }

  // BFS初期化
  const queue: string[] = [masterNode.id];
  distances.set(masterNode.id, 0);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDistance = distances.get(currentId)!;

    // 隣接ノードを探索
    const neighbors = getConnectedNodes(currentId, nodes, edges);

    for (const neighbor of neighbors) {
      if (!distances.has(neighbor.id)) {
        distances.set(neighbor.id, currentDistance + 1);
        queue.push(neighbor.id);
      }
    }
  }

  return distances;
}

/**
 * 2つのノード間のエッジを取得
 */
export function getEdgeBetween(
  nodeId1: string,
  nodeId2: string,
  edges: Edge[]
): Edge | null {
  return (
    edges.find(
      (edge) =>
        (edge.source === nodeId1 && edge.target === nodeId2) ||
        (edge.source === nodeId2 && edge.target === nodeId1)
    ) || null
  );
}

/**
 * マスタ局に近い方のノードを判定
 * @returns { nearer: より近い方のノード, farther: より遠い方のノード }
 */
export function determineNearerAndFarther(
  node1: Node<FlowNodeData>,
  node2: Node<FlowNodeData>,
  distances: Map<string, number>
): { nearer: Node<FlowNodeData>; farther: Node<FlowNodeData> } | null {
  const dist1 = distances.get(node1.id);
  const dist2 = distances.get(node2.id);

  if (dist1 === undefined || dist2 === undefined) {
    return null; // 距離が計算されていない（孤立ノード等）
  }

  if (dist1 < dist2) {
    return { nearer: node1, farther: node2 };
  } else if (dist2 < dist1) {
    return { nearer: node2, farther: node1 };
  } else {
    // 同じ距離の場合は判定不可（通常は発生しないはず）
    return null;
  }
}

/**
 * ノードがスイッチかどうかを判定
 */
export function isSwitch(node: Node<FlowNodeData>): boolean {
  const stationType = node.data.stationType;
  return stationType === 'switch-classB' || 
         stationType === 'switch-classA' || 
         stationType === 'switch-general';
}

/**
 * ノードがTSN機器（マスタ/ローカル/リモート）かどうかを判定
 */
export function isTSNDevice(node: Node<FlowNodeData>): boolean {
  const stationType = node.data.stationType;
  return stationType === 'master' || 
         stationType === 'local' || 
         stationType === 'remote';
}

/**
 * ノードが検証対象機器（TSN機器またはEthernet機器）かどうかを判定
 */
export function isValidatableDevice(node: Node<FlowNodeData>): boolean {
  const stationType = node.data.stationType;
  return stationType === 'master' || 
         stationType === 'local' || 
         stationType === 'remote' ||
         stationType === 'ethernet-device';
}

/**
 * スイッチを経由した論理的な接続を取得
 * スイッチを透過して、検証対象機器（TSN機器・Ethernet機器）間の論理的な接続ペアを返す
 */
export function getLogicalConnections(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): Array<{ node1: Node<FlowNodeData>; node2: Node<FlowNodeData>; viaSwitch: boolean; path: string[] }> {
  const connections: Array<{ node1: Node<FlowNodeData>; node2: Node<FlowNodeData>; viaSwitch: boolean; path: string[] }> = [];
  const validatableDevices = nodes.filter(isValidatableDevice); // TSN機器とEthernet機器

  // 各検証対象機器から他の検証対象機器への最短経路を探索
  for (const device1 of validatableDevices) {
    const visited = new Set<string>([device1.id]);
    const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: device1.id, path: [device1.id] }];

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      const neighbors = getConnectedNodes(nodeId, nodes, edges);

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);

        const newPath = [...path, neighbor.id];

        // 検証対象機器に到達したら接続として記録
        if (isValidatableDevice(neighbor) && neighbor.id !== device1.id) {
          const viaSwitch = newPath.length > 2; // 2ホップ以上ならスイッチ経由
          connections.push({
            node1: device1,
            node2: neighbor,
            viaSwitch,
            path: newPath
          });
        }

        // スイッチの場合は探索を継続
        if (isSwitch(neighbor)) {
          queue.push({ nodeId: neighbor.id, path: newPath });
        }
      }
    }
  }

  return connections;
}

/**
 * 2つのノード間のパスをBFSで探索
 * @param start 開始ノード
 * @param end 終了ノード
 * @param edges エッジリスト
 * @param nodes ノードリスト
 * @returns パス情報（ノードとエッジのリスト）、見つからなければnull
 */
export function findPath(
  start: Node<FlowNodeData>,
  end: Node<FlowNodeData>,
  edges: Edge[],
  nodes: Node<FlowNodeData>[]
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } | null {
  if (start.id === end.id) {
    return { nodes: [start], edges: [] };
  }

  const queue: Array<{
    node: Node<FlowNodeData>;
    path: Node<FlowNodeData>[];
    edgePath: Edge[];
  }> = [{ node: start, path: [start], edgePath: [] }];
  const visited = new Set<string>([start.id]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const { node, path, edgePath } = current;

    // 隣接するエッジを取得
    const adjacentEdges = edges.filter(
      (e) => e.source === node.id || e.target === node.id
    );

    for (const edge of adjacentEdges) {
      const nextId = edge.source === node.id ? edge.target : edge.source;

      if (visited.has(nextId)) continue;
      visited.add(nextId);

      const nextNode = nodes.find((n) => n.id === nextId);
      if (!nextNode) continue;

      const newPath = [...path, nextNode];
      const newEdgePath = [...edgePath, edge];

      // 目的地に到達
      if (nextNode.id === end.id) {
        return { nodes: newPath, edges: newEdgePath };
      }

      queue.push({
        node: nextNode,
        path: newPath,
        edgePath: newEdgePath,
      });
    }
  }

  return null; // パスが見つからない
}

/**
 * スイッチノードの種別を取得
 * @param switchNode スイッチノード
 * @returns 'S' (Class B対応), 'H' (Class A対応), 'N' (汎用)
 */
export function getSwitchType(switchNode: Node<FlowNodeData>): 'S' | 'H' | 'N' {
  const stationType = switchNode.data.stationType;
  if (stationType === 'switch-classB') return 'S';
  if (stationType === 'switch-classA') return 'H';
  if (stationType === 'switch-general') return 'N';
  return 'N'; // デフォルト
}

/**
 * ネットワークにループ（サイクル）が存在するかを判定
 * DFS（深さ優先探索）を使用してグラフのサイクルを検出
 * @param nodes ノードリスト
 * @param edges エッジリスト
 * @returns true = ループが存在, false = ループが存在しない
 */
export function hasLoop(nodes: Node<FlowNodeData>[], edges: Edge[]): boolean {
  // グラフを隣接リストで表現
  const adjacencyList = new Map<string, string[]>();
  
  nodes.forEach(node => {
    adjacencyList.set(node.id, []);
  });
  
  edges.forEach(edge => {
    const source = adjacencyList.get(edge.source) || [];
    const target = adjacencyList.get(edge.target) || [];
    source.push(edge.target);
    target.push(edge.source);
    adjacencyList.set(edge.source, source);
    adjacencyList.set(edge.target, target);
  });
  
  // 訪問状態を管理: 0 = 未訪問, 1 = 訪問中, 2 = 訪問完了
  const state = new Map<string, number>();
  nodes.forEach(node => {
    state.set(node.id, 0);
  });
  
  // DFS でサイクルを検出
  const hasCycleDFS = (nodeId: string, parent: string | null): boolean => {
    state.set(nodeId, 1); // 訪問中
    
    const neighbors = adjacencyList.get(nodeId) || [];
    
    for (const neighbor of neighbors) {
      // 親ノードへの戻りは無視（無向グラフの場合）
      if (parent && neighbor === parent) continue;
      
      const neighborState = state.get(neighbor);
      
      if (neighborState === 1) {
        // 訪問中のノードへの接続 = サイクル検出
        return true;
      }
      
      if (neighborState === 0) {
        // 未訪問なら再帰
        if (hasCycleDFS(neighbor, nodeId)) {
          return true;
        }
      }
    }
    
    state.set(nodeId, 2); // 訪問完了
    return false;
  };
  
  // すべての未訪問ノードから DFS を開始（連結成分を考慮）
  for (const node of nodes) {
    if (state.get(node.id) === 0) {
      if (hasCycleDFS(node.id, null)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * ループを構成するエッジIDを取得
 * @returns ループを構成するエッジIDの配列
 */
export function findLoopEdges(nodes: Node<FlowNodeData>[], edges: Edge[]): string[] {
  // 後方互換性のため、最初のリングのみを返す
  const allLoops = findAllLoopEdges(nodes, edges);
  return allLoops.length > 0 ? allLoops[0].edgeIds : [];
}

/**
 * すべてのリングを検出し、リングごとのエッジIDとノードIDを返す
 */
export function findAllLoopEdges(nodes: Node<FlowNodeData>[], edges: Edge[]): Array<{ edgeIds: string[]; nodeIds: string[] }> {
  const allCycles: Array<{ edgeIds: string[]; nodeIds: string[] }> = [];
  const remainingEdges = [...edges]; // エッジのコピー
  
  // サイクルがなくなるまで繰り返す
  while (true) {
    const cycle = findOneCycle(nodes, remainingEdges);
    if (!cycle) break; // サイクルが見つからなければ終了
    
    allCycles.push(cycle);
    
    // 検出したサイクルのエッジを除外
    cycle.edgeIds.forEach(edgeId => {
      const index = remainingEdges.findIndex(e => e.id === edgeId);
      if (index !== -1) {
        remainingEdges.splice(index, 1);
      }
    });
  }
  
  return allCycles;
}

/**
 * 1つのサイクルを検出する（内部関数）
 */
function findOneCycle(nodes: Node<FlowNodeData>[], edges: Edge[]): { edgeIds: string[]; nodeIds: string[] } | null {
  // グラフを隣接リストで表現
  const adjacencyList = new Map<string, string[]>();
  
  nodes.forEach(node => {
    adjacencyList.set(node.id, []);
  });
  
  edges.forEach(edge => {
    const source = adjacencyList.get(edge.source) || [];
    const target = adjacencyList.get(edge.target) || [];
    source.push(edge.target);
    target.push(edge.source);
    adjacencyList.set(edge.source, source);
    adjacencyList.set(edge.target, target);
  });
  
  // 訪問状態を管理: 0 = 未訪問, 1 = 訪問中, 2 = 訪問完了
  const globalState = new Map<string, number>();
  nodes.forEach(node => {
    globalState.set(node.id, 0);
  });
  
  // DFS でサイクルを検出
  const hasCycleDFS = (
    nodeId: string, 
    parentId: string | null,
    state: Map<string, number>,
    parent: Map<string, string | null>
  ): { start: string; end: string } | null => {
    state.set(nodeId, 1); // 訪問中
    parent.set(nodeId, parentId);
    
    const neighbors = adjacencyList.get(nodeId) || [];
    
    for (const neighbor of neighbors) {
      // 親ノードへの戻りは無視（無向グラフの場合）
      if (parentId && neighbor === parentId) continue;
      
      const neighborState = state.get(neighbor);
      
      if (neighborState === 1) {
        // 訪問中のノードへの接続 = サイクル検出
        return { start: neighbor, end: nodeId };
      }
      
      if (neighborState === 0) {
        // 未訪問なら再帰
        const cycle = hasCycleDFS(neighbor, nodeId, state, parent);
        if (cycle) {
          return cycle;
        }
      }
    }
    
    state.set(nodeId, 2); // 訪問完了
    return null;
  };
  
  // すべての未訪問ノードから DFS を開始（連結成分を考慮）
  for (const node of nodes) {
    if (globalState.get(node.id) === 0) {
      // 各DFSツリーごとに独立したstateとparentを作成
      const state = new Map<string, number>();
      const parent = new Map<string, string | null>();
      nodes.forEach(n => {
        state.set(n.id, globalState.get(n.id) || 0);
      });
      
      const cycle = hasCycleDFS(node.id, null, state, parent);
      
      // このDFSツリーで訪問したノードの状態をglobalStateに反映
      state.forEach((value, key) => {
        if (value === 2) {
          globalState.set(key, 2);
        }
      });
      
      if (cycle) {
        // サイクルを構成するノードIDを収集
        const cycleNodes = new Set<string>();
        cycleNodes.add(cycle.start);
        let current: string | null = cycle.end;
        
        while (current && current !== cycle.start) {
          cycleNodes.add(current);
          current = parent.get(current) || null;
        }
        
        // サイクルを構成するエッジIDを収集
        const loopEdgeIds: string[] = [];
        
        edges.forEach(edge => {
          const sourceInCycle = cycleNodes.has(edge.source);
          const targetInCycle = cycleNodes.has(edge.target);
          
          // 両端がサイクル内にあるエッジを追加
          if (sourceInCycle && targetInCycle) {
            loopEdgeIds.push(edge.id);
          }
        });
        
        return {
          edgeIds: loopEdgeIds,
          nodeIds: Array.from(cycleNodes)
        };
      }
    }
  }
  
  return null; // サイクルが見つからなかった
}

/**
 * 指定ノードのマスタ局からの距離を取得
 * @param targetNodeId 対象ノードのID
 * @param masterNodeId マスタ局のID
 * @param nodes 全ノード
 * @param edges 全エッジ
 * @returns マスタからの距離（到達不可能な場合はInfinity）
 */
export function getDistanceFromMaster(
  targetNodeId: string,
  masterNodeId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): number {
  const distances = calculateDistancesFromMaster(nodes, edges);
  const distance = distances.get(targetNodeId);
  return distance !== undefined ? distance : Infinity;
}

/**
 * 指定ノードに隣接する全ノードを取得
 * （getConnectedNodesのエイリアス - 名前を明確にするため）
 * @param nodeId ノードID
 * @param nodes 全ノード
 * @param edges 全エッジ
 * @returns 隣接するノードの配列
 */
export function getNodesConnectedToNode(
  nodeId: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): Node<FlowNodeData>[] {
  return getConnectedNodes(nodeId, nodes, edges);
}

/**
 * ネットワーク内にクラスAとクラスBが混在しているか判定
 * マスタ局から到達可能なノード内で、Class Aのリモート局が存在するかチェック
 * @param nodes 全ノード
 * @param edges 全エッジ
 * @returns BA混在の場合true、クラスBのみの場合false
 */
export function isClassBAMixed(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): boolean {
  const reachableNodes = getReachableNodes(nodes, edges);
  return reachableNodes.some(
    (node) =>
      node.data.stationType === 'remote' && node.data.deviceClass === 'A'
  );
}
