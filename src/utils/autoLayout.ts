// SPDX-License-Identifier: Apache-2.0
import { Node, Edge } from 'reactflow';
import type { Viewport } from 'reactflow';
import { FlowNodeData, Topology } from '../types/flow';

/**
 * トポロジを自動判定
 */
export function detectTopology(nodes: Node<FlowNodeData>[], edges: Edge[]): Topology {
  console.log('[detectTopology] 開始', { nodes: nodes.length, edges: edges.length });
  
  const master = nodes.find(n => n.data.stationType === 'master');
  if (!master) {
    console.log('[detectTopology] マスタ局なし → MIXED');
    return 'MIXED';
  }
  
  // 各ノードの接続数（次数）をカウント
  const degreeMap = new Map<string, number>();
  nodes.forEach(n => degreeMap.set(n.id, 0));
  
  edges.forEach(edge => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
  });
  
  console.log('[detectTopology] 次数マップ:', Array.from(degreeMap.entries()));
  
  const degrees = Array.from(degreeMap.values());
  const degree1Count = degrees.filter(d => d === 1).length;
  const degree2Count = degrees.filter(d => d === 2).length;
  
  // リング判定: すべてのノードが次数2（閉じたループ）
  if (degrees.every(deg => deg === 2) && nodes.length >= 3) {
    console.log('[detectTopology] → RING');
    return 'RING';
  }
  
  // スター判定: マスタ → 中央スイッチ(次数3以上) → 複数デバイス(次数1)
  // 条件: マスタ次数1、スイッチ1台が高次数、他がすべて次数1
  const masterDegree = degreeMap.get(master.id) || 0;
  const otherNodes = nodes.filter(n => n.id !== master.id);
  
  // スイッチ候補: 次数が3以上のノード
  const switchCandidates = otherNodes.filter(n => {
    const deg = degreeMap.get(n.id) || 0;
    const isSwitch = n.data.stationType?.startsWith('switch');
    return deg >= 3 && isSwitch;
  });
  
  // スター条件: マスタ次数1、スイッチ1台、他のデバイスがすべて次数1
  if (masterDegree === 1 && switchCandidates.length === 1) {
    const switchNode = switchCandidates[0];
    const devices = otherNodes.filter(n => n.id !== switchNode.id);
    const allDevicesLeaf = devices.every(n => degreeMap.get(n.id) === 1);
    
    if (allDevicesLeaf && devices.length > 0) {
      console.log('[detectTopology] → STAR (中央スイッチ型)');
      return 'STAR';
    }
  }
  
  // ライン判定: 両端が次数1、中間がすべて次数2
  if (degree1Count === 2 && degree2Count === nodes.length - 2 && nodes.length >= 2) {
    console.log('[detectTopology] → LINE');
    return 'LINE';
  }
  
  // それ以外は混在
  console.log('[detectTopology] → MIXED');
  return 'MIXED';
}

/**
 * トポロジに応じた自動レイアウトを生成（統合エントリーポイント）
 */
export function generateAutoLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  viewport: Viewport
): Node<FlowNodeData>[] {
  const topology = detectTopology(nodes, edges);
  console.log('[generateAutoLayout] トポロジ:', topology);
  
  switch (topology) {
    case 'LINE':
      return generateHierarchicalLayout(nodes, edges, viewport);
    case 'STAR':
      return generateStarLayout(nodes, edges, viewport);
    case 'RING':
      return generateRingLayout(nodes, edges, viewport);
    case 'MIXED':
      return generateMixedLayout(nodes, edges, viewport);
  }
}

/**
 * 階層型レイアウト: マスタ局を左上に配置し、接続された機器を右下に展開（LINE用）
 */
export function generateHierarchicalLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  viewport: Viewport
): Node<FlowNodeData>[] {
  console.log('[generateHierarchicalLayout] 開始', { nodes: nodes.length, edges: edges.length, viewport });
  
  // マスタ局を検索
  const masterNode = nodes.find(n => n.data.stationType === 'master');
  console.log('[generateHierarchicalLayout] マスタ局:', masterNode?.id);
  
  if (!masterNode) {
    // マスタ局がない場合は元の位置を返す
    console.warn('[generateHierarchicalLayout] マスタ局が見つかりません');
    return nodes;
  }

  // 各ノードの階層（マスタからの距離）を計算
  const layers = calculateLayers(nodes, edges, masterNode.id);
  console.log('[generateHierarchicalLayout] 階層計算完了:', Array.from(layers.entries()));
  
  // 階層ごとにノードをグループ化し、親ノードと接続ポート情報も保持
  const nodesByLayer = new Map<number, Array<{ node: Node<FlowNodeData>; parentId: string; portNumber: number }>>();
  nodes.forEach(node => {
    const layer = layers.get(node.id) ?? 0;
    if (!nodesByLayer.has(layer)) {
      nodesByLayer.set(layer, []);
    }
    
    // このノードの親ノード(1つ前の階層で接続されているノード)と接続ポートを取得
    const parentEdges = edges.filter(edge => {
      const connectedId = edge.target === node.id ? edge.source : edge.target;
      const parentLayer = layers.get(connectedId);
      return parentLayer !== undefined && parentLayer < layer;
    });
    
    // 親ノードが複数ある場合は最初の1つを使用
    if (parentEdges.length > 0) {
      const parentEdge = parentEdges[0];
      const parentId = parentEdge.target === node.id ? parentEdge.source : parentEdge.target;
      
      // ポート番号を抽出 (sourceHandle or targetHandle から)
      const handleId = parentEdge.source === parentId ? parentEdge.sourceHandle : parentEdge.targetHandle;
      console.log(`[autoLayout] ノード ${node.id}: parentEdge=`, parentEdge, `handleId=${handleId}`);
      
      // handleIdから数字を抽出 (例: "port1_out" → 1, "port2_in" → 2)
      const portMatch = handleId?.match(/port(\d+)/);
      const portNumber = portMatch ? parseInt(portMatch[1], 10) : 0;
      console.log(`[autoLayout] ノード ${node.id}: 抽出されたポート番号=${portNumber}`);
      
      nodesByLayer.get(layer)!.push({ node, parentId, portNumber });
    } else {
      // 親が見つからない場合はデフォルト値
      nodesByLayer.get(layer)!.push({ node, parentId: '', portNumber: 0 });
    }
  });

  console.log('[generateHierarchicalLayout] 階層別ノード数:', Array.from(nodesByLayer.entries()).map(([l, ns]) => [l, ns.length]));

  // 配置パラメータ
  // viewportを使って現在のキャンバス表示位置を起点にする
  const START_X = -viewport.x / viewport.zoom + 50;
  const START_Y = -viewport.y / viewport.zoom + 50;
  const LAYER_OFFSET_X = 20; // 階層間の横間隔(右に進む)
  const LAYER_OFFSET_Y = 75; // 階層間の縦間隔(下に進む)
  const COLUMN_OFFSET_X = 100; // 列間の横間隔（10ノード後に右に移動）- 200から100に縮小
  const NODES_PER_COLUMN = 10; // 1列あたりのノード数

  // 各階層のノードを配置
  const positionedNodes: Node<FlowNodeData>[] = [];
  const nodePositions = new Map<string, { x: number; y: number }>();
  
  // マスタ局を先に配置（列0、行0）
  const masterPos = { x: START_X, y: START_Y };
  nodePositions.set(masterNode.id, masterPos);
  console.log(`[generateHierarchicalLayout] 配置: ${masterNode.id} (マスタ) -> (${masterPos.x}, ${masterPos.y})`);
  positionedNodes.push({
    ...masterNode,
    position: masterPos
  });
  
  let nodeCounter = 0; // マスタ局を0番目とカウント（10台目で次の列へ）
  
  for (const [layer, layerNodesInfo] of Array.from(nodesByLayer.entries()).sort((a, b) => a[0] - b[0])) {
    if (layer === 0) {
      // マスタ局は既に配置済みなのでスキップ
      continue;
    } else {
      // 同じ階層のノードを配置
      // 同じ階層に複数ノードがある場合は、ポート番号でソート（大きい方が左側＝先に配置）
      const sortedNodes = layerNodesInfo.length > 1
        ? [...layerNodesInfo].sort((a, b) => b.portNumber - a.portNumber)
        : layerNodesInfo;
      
      sortedNodes.forEach((nodeInfo) => {
        nodeCounter++; // マスタの次から1, 2, 3...とカウント
        
        // nodeCounterに基づいて列と行を計算
        const columnIndex = Math.floor(nodeCounter / NODES_PER_COLUMN);
        const rowIndex = nodeCounter % NODES_PER_COLUMN;
        
        // 階層間でLAYER_OFFSET_Xでずらす
        const baseX = START_X + layer * LAYER_OFFSET_X + columnIndex * COLUMN_OFFSET_X;
        const baseY = START_Y + rowIndex * LAYER_OFFSET_Y;
        
        const x = baseX;
        const y = baseY;
        
        nodePositions.set(nodeInfo.node.id, { x, y });
        console.log(`[generateHierarchicalLayout] 配置: ${nodeInfo.node.id} (層${layer}, 全体カウント${nodeCounter}, 列${columnIndex}, 行${rowIndex}, port${nodeInfo.portNumber}) -> (${x}, ${y})`);
        positionedNodes.push({
          ...nodeInfo.node,
          position: { x, y }
        });
      });
    }
  }

  console.log('[generateHierarchicalLayout] 完了:', positionedNodes.length);
  return positionedNodes;
}

/**
 * BFS（幅優先探索）で各ノードの階層を計算
 */
function calculateLayers(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  masterId: string
): Map<string, number> {
  const layers = new Map<string, number>();
  const queue: Array<{ nodeId: string; layer: number }> = [{ nodeId: masterId, layer: 0 }];
  const visited = new Set<string>([masterId]);

  layers.set(masterId, 0);

  while (queue.length > 0) {
    const { nodeId, layer } = queue.shift()!;

    // 接続されているノードを探索
    const connectedNodeIds = edges
      .filter(edge => edge.source === nodeId || edge.target === nodeId)
      .map(edge => edge.source === nodeId ? edge.target : edge.source)
      .filter(id => !visited.has(id));

    for (const connectedId of connectedNodeIds) {
      visited.add(connectedId);
      layers.set(connectedId, layer + 1);
      queue.push({ nodeId: connectedId, layer: layer + 1 });
    }
  }

  return layers;
}

/**
 * スター型レイアウト: マスタ → 中央スイッチ → 放射状にデバイス配置
 */
export function generateStarLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  viewport: Viewport
): Node<FlowNodeData>[] {
  console.log('[generateStarLayout] 開始', { nodes: nodes.length, edges: edges.length });
  
  const master = nodes.find(n => n.data.stationType === 'master');
  if (!master) {
    console.warn('[generateStarLayout] マスタ局が見つかりません');
    return nodes;
  }
  
  // 中央スイッチを検出（次数が最も大きいスイッチノード）
  const degreeMap = new Map<string, number>();
  nodes.forEach(n => degreeMap.set(n.id, 0));
  edges.forEach(edge => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + 1);
  });
  
  const switchNode = nodes
    .filter(n => n.id !== master.id && n.data.stationType?.startsWith('switch'))
    .sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0))[0];
  
  if (!switchNode) {
    console.warn('[generateStarLayout] 中央スイッチが見つかりません');
    return nodes;
  }
  
  const devices = nodes.filter(n => n.id !== master.id && n.id !== switchNode.id);
  
  // 配置座標
  const centerX = -viewport.x / viewport.zoom + 400;
  const centerY = -viewport.y / viewport.zoom + 300;
  const masterOffsetY = -200; // マスタはスイッチの上
  const deviceRadius = 250; // デバイスの放射半径
  
  const positionedNodes: Node<FlowNodeData>[] = [
    {
      ...master,
      position: { x: centerX, y: centerY + masterOffsetY }
    },
    {
      ...switchNode,
      position: { x: centerX, y: centerY }
    }
  ];
  
  // デバイスを円周上に配置（12時方向から時計回り、ただしマスタ位置を避ける）
  devices.forEach((node, i) => {
    // -90度（12時）を避けて、-45度から始める
    const startAngle = -Math.PI / 4; // -45度
    const angle = startAngle + (Math.PI * 2 * i) / devices.length;
    positionedNodes.push({
      ...node,
      position: {
        x: centerX + deviceRadius * Math.cos(angle),
        y: centerY + deviceRadius * Math.sin(angle)
      }
    });
  });
  
  console.log('[generateStarLayout] 完了:', positionedNodes.length);
  return positionedNodes;
}

/**
 * リング型レイアウト: マスタから接続順に円周上に配置
 */
export function generateRingLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  viewport: Viewport
): Node<FlowNodeData>[] {
  console.log('[generateRingLayout] 開始', { nodes: nodes.length, edges: edges.length });
  
  const master = nodes.find(n => n.data.stationType === 'master');
  if (!master) {
    console.warn('[generateRingLayout] マスタ局が見つかりません');
    return nodes;
  }
  
  // リング順序: マスタから時計回りに接続されているノードを辿る
  const ringOrder = getRingOrder(nodes, edges, master.id);
  
  const centerX = -viewport.x / viewport.zoom + 500;
  const centerY = -viewport.y / viewport.zoom + 350;
  const radius = 280;
  
  const positionedNodes: Node<FlowNodeData>[] = [];
  
  // マスタを12時位置（上部）に配置し、そこから時計回りに順次配置
  ringOrder.forEach((node, i) => {
    // -90度（12時位置）からスタートし、時計回りに配置
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / ringOrder.length;
    positionedNodes.push({
      ...node,
      position: {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      }
    });
  });
  
  console.log('[generateRingLayout] 完了:', positionedNodes.length, '順序:', ringOrder.map(n => n.data.label));
  return positionedNodes;
}

/**
 * 混在型レイアウト: 階層レイアウトを横広げで対応
 */
export function generateMixedLayout(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  viewport: Viewport
): Node<FlowNodeData>[] {
  console.log('[generateMixedLayout] 開始 - 階層レイアウトを使用', { nodes: nodes.length, edges: edges.length });
  
  const master = nodes.find(n => n.data.stationType === 'master');
  if (!master) {
    console.warn('[generateMixedLayout] マスタ局が見つかりません');
    return nodes;
  }
  
  // 各ノードの階層を計算
  const layers = calculateLayers(nodes, edges, master.id);
  
  // 階層ごとにグループ化
  const nodesByLayer = new Map<number, Node<FlowNodeData>[]>();
  nodes.forEach(node => {
    const layer = layers.get(node.id) ?? 0;
    if (!nodesByLayer.has(layer)) {
      nodesByLayer.set(layer, []);
    }
    nodesByLayer.get(layer)!.push(node);
  });
  
  // 配置パラメータ
  const START_X = -viewport.x / viewport.zoom + 50;
  const START_Y = -viewport.y / viewport.zoom + 50;
  const LAYER_WIDTH = 250; // 階層間の横幅
  const VERTICAL_SPACING = 100; // ノード間の縦間隔
  
  const positionedNodes: Node<FlowNodeData>[] = [];
  
  for (const [layer, layerNodes] of Array.from(nodesByLayer.entries()).sort((a, b) => a[0] - b[0])) {
    const startY = START_Y - (layerNodes.length * VERTICAL_SPACING) / 2;
    
    layerNodes.forEach((node, i) => {
      positionedNodes.push({
        ...node,
        position: {
          x: START_X + layer * LAYER_WIDTH,
          y: startY + i * VERTICAL_SPACING
        }
      });
    });
  }
  
  console.log('[generateMixedLayout] 完了:', positionedNodes.length);
  return positionedNodes;
}

/**
 * リング構成の接続順序を取得（マスタから時計回り）
 */
function getRingOrder(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  startId: string
): Node<FlowNodeData>[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const ordered: Node<FlowNodeData>[] = [];
  const visited = new Set<string>();
  
  let currentId = startId;
  let prevId: string | null = null;
  
  // マスタから開始し、リングを一周する
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const currentNode = nodeMap.get(currentId);
    if (currentNode) {
      ordered.push(currentNode);
    }
    
    // 現在のノードに接続されている次のノード（前のノード以外）を取得
    const connectedEdges = edges.filter(
      edge => edge.source === currentId || edge.target === currentId
    );
    
    const nextIds = connectedEdges
      .map(edge => edge.source === currentId ? edge.target : edge.source)
      .filter(id => id !== prevId && !visited.has(id));
    
    if (nextIds.length > 0) {
      prevId = currentId;
      currentId = nextIds[0];
    } else {
      // 次のノードがない場合は終了（リング完成）
      break;
    }
  }
  
  console.log('[getRingOrder] リング順序:', ordered.map(n => n.data.label).join(' → '));
  return ordered;
}

/**
 * BFSで接続順序を取得（その他のトポロジ用）
 */
function bfsOrder(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  startId: string
): Node<FlowNodeData>[] {
  const ordered: Node<FlowNodeData>[] = [];
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const node = nodeMap.get(nodeId);
    if (node) {
      ordered.push(node);
    }
    
    // 接続されているノードを探索
    const connectedNodeIds = edges
      .filter(edge => edge.source === nodeId || edge.target === nodeId)
      .map(edge => edge.source === nodeId ? edge.target : edge.source)
      .filter(id => !visited.has(id));
    
    for (const connectedId of connectedNodeIds) {
      visited.add(connectedId);
      queue.push(connectedId);
    }
  }
  
  return ordered;
}
