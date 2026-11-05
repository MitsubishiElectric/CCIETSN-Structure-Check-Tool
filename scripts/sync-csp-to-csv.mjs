#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * CSP データから CSV を同期・更新するスクリプト
 * 
 * 以下の情報を CSP から抽出して CSV に反映：
 * - deviceName (modelName)
 * - defaultClass (classDefault)
 * - deviceClass (サポートクラス、複数値)
 * - cyclicDataBytes (R_B_DefaultSize, R_W_DefaultSize から計算)
 * 
 * 以下は保護（上書きしない）：
 * - speed, speedOptions （手動で設定した値を保持）
 * - maxStations, defaultPortCount, minPorts, maxPorts, defaultPortType, supportsOpticalPorts
 * - supportsMulticastFilter, isRingCapable, firmwareVersion, protocolVersion, hardwareVersion
 * - cycleSetting
 * - notes
 *
 * 以下は自動更新（CSP から上書き）：
 * - category （deviceTypeDetailRaw から正規化）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * DeviceTypeDetail を日本語に正規化するための多言語辞書
 * （build-csp-index.mjs と同じ辞書）
 */
const deviceTypeDetailDict = {
  // インバータ関連
  "General purpose Inverter": "汎用インバータ",
  "汎用インバータ": "汎用インバータ",
  "通用变频器": "汎用インバータ",
  // I/O関連
  "DC Input": "DC入力",
  "DC入力": "DC入力",
  "DC输入": "DC入力",
  "Transistor Output": "トランジスタ出力",
  "トランジスタ出力": "トランジスタ出力",
  "晶体管输出": "トランジスタ出力",
  "I/O Combined": "入出力混合",
  "入出力混合": "入出力混合",
  "输入输出混合": "入出力混合",
  "Analog Input": "アナログ入力",
  "アナログ入力": "アナログ入力",
  "模拟输入": "アナログ入力",
  "Analog Output": "アナログ出力",
  "アナログ出力": "アナログ出力",
  "模拟输出": "アナログ出力",
  // 通信・ネットワーク関連
  "Communication Unit": "通信ユニット",
  "通信ユニット": "通信ユニット",
  "Comm. Unit": "通信ユニット",
  "master/local module": "マスタ・ローカルユニット",
  "マスタ/ローカルユニット": "マスタ・ローカルユニット",
  "マスタ・ローカルユニット": "マスタ・ローカルユニット",
  "主站/本地站模块": "マスタ・ローカルユニット",
  "Network Interface Board": "ネットワークインタフェースボード",
  "ネットワークインタフェースボード": "ネットワークインタフェースボード",
  "Bridge module": "ブリッジユニット",
  "ブリッジユニット": "ブリッジユニット",
  "网桥模块": "ブリッジユニット",
  // 制御・ユニット関連
  "Switch": "スイッチ",
  "スイッチ": "スイッチ",
  "Gateway": "ゲートウェイ",
  "ゲートウェイ": "ゲートウェイ",
  "Controller": "コントローラ",
  "コントローラ": "コントローラ",
  "I/O Unit": "I/Oユニット",
  "I/Oユニット": "I/Oユニット",
  "FPGA module": "FPGAユニット",
  "FPGAユニット": "FPGAユニット",
  "FPGA模块": "FPGAユニット",
  "リニアトラック制御ユニット": "リニアトラック制御ユニット",
  // サーボ関連
  "General-Purpose AC Servo": "汎用ACサーボ",
  "汎用ACサーボ": "汎用ACサーボ",
  "通用AC伺服": "汎用ACサーボ",
  // エネルギー・計測関連
  "EnergyMeasuringUnit": "エネルギー計測ユニット",
  "エネルギー計測ユニット": "エネルギー計測ユニット",
  // その他
  "Other": "その他",
  "その他": "その他"
};

/**
 * DeviceTypeDetail を日本語に正規化
 */
function normalizeDeviceTypeDetail(raw) {
  if (!raw) return "その他";
  const key = raw.trim();
  return deviceTypeDetailDict[key] || "その他";
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ファイルパス
const cspIndexPath = path.join(projectRoot, 'public/csp/csp-index.json');
const csvPath = path.join(projectRoot, 'public/data/device-defaults.csv');

// CSP インデックスを読み込み
console.log(`📖 CSP インデックスを読み込み: ${cspIndexPath}`);
const cspData = JSON.parse(fs.readFileSync(cspIndexPath, 'utf-8'));

// デバイスマップ（modelName → CSPデバイス）を作成
// 同じmodelNameの場合は、バージョン番号が最新で日本語を優先
const cspMap = new Map();

// バージョン番号を抽出（id から _数字_ パターン）
const extractVersion = (id) => {
  const match = id.match(/_(\d+)_/);
  return match ? parseInt(match[1], 10) : 0;
};

for (const device of cspData.devices) {
  const existing = cspMap.get(device.modelName);
  if (!existing) {
    cspMap.set(device.modelName, device);
    continue;
  }
  
  const existingVersion = extractVersion(existing.id);
  const currentVersion = extractVersion(device.id);
  
  // バージョン番号で比較
  if (currentVersion > existingVersion) {
    cspMap.set(device.modelName, device);
  } else if (currentVersion === existingVersion) {
    // 同じバージョンなら日本語 (_ja) を優先
    if (device.id.includes('_ja') && !existing.id.includes('_ja')) {
      cspMap.set(device.modelName, device);
    }
  }
}
console.log(`✅ ${cspData.devices.length} 個のCSPデバイスを読み込み（最新バージョン優先で ${cspMap.size} 個に集約）`);

// CSV を読み込み
console.log(`\n📖 CSV を読み込み: ${csvPath}`);
let csvContent = fs.readFileSync(csvPath, 'utf-8');

// BOM と改行形式を検出・保持（常に UTF-8 BOM + CRLF に統一）
const hasBOM = csvContent.startsWith('\uFEFF');  // U+FEFF = UTF-8 BOM
if (hasBOM) csvContent = csvContent.slice(1);  // BOM を削除（後で再付加）

// 常に BOM + CRLF を使用する標準化ポリシー
const useBOM = true;
const useCRLF = true;

// 行を分割（CRLF と LF の両方に対応）
const lines = csvContent.split(/\r?\n/);

// セクション分割：ヘッダーコメント行と機器行を分類
let currentSection = null;
const sections = {
  master: { startIdx: null, endIdx: null, headerIdx: null, devices: [] },
  localRemote: { startIdx: null, endIdx: null, headerIdx: null, devices: [] },
  switch: { startIdx: null, endIdx: null, headerIdx: null, devices: [] },
  ethernet: { startIdx: null, endIdx: null, headerIdx: null, devices: [] },
  generic: { startIdx: null, endIdx: null, headerIdx: null, devices: [] }
};

let sectionMap = {};
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes('# === Master Devices ===')) {
    currentSection = 'master';
    sections.master.startIdx = i;
  } else if (line.includes('# === Local/Remote Devices ===')) {
    if (currentSection === 'master') sections.master.endIdx = i - 1;
    currentSection = 'localRemote';
    sections.localRemote.startIdx = i;
  } else if (line.includes('# === Switch Devices ===')) {
    if (currentSection === 'localRemote') sections.localRemote.endIdx = i - 1;
    currentSection = 'switch';
    sections.switch.startIdx = i;
  } else if (line.includes('# === Ethernet Devices ===')) {
    if (currentSection === 'switch') sections.switch.endIdx = i - 1;
    currentSection = 'ethernet';
    sections.ethernet.startIdx = i;
  } else if (line.includes('# === Generic Devices ===')) {
    if (currentSection === 'ethernet') sections.ethernet.endIdx = i - 1;
    currentSection = 'generic';
    sections.generic.startIdx = i;
  } else if (currentSection && line.startsWith('# deviceId,')) {
    sections[currentSection].headerIdx = i;
  } else if (currentSection && !line.startsWith('#') && !line.startsWith(' ') && line.trim()) {
    sections[currentSection].devices.push({ lineIdx: i, content: line });
  }
}
if (sections.generic.endIdx === null) sections.generic.endIdx = lines.length - 1;

console.log(`✅ CSV をセクション分割（Master: ${sections.master.devices.length}, Local/Remote: ${sections.localRemote.devices.length}）`);

/**
 * ヘッダー行からフィールドインデックスマッピングを作成
 */
function createHeaderIndexMap(headerLine) {
  if (!headerLine.startsWith('# ')) return {};
  const headerStr = headerLine.slice(2); // '# ' を削除
  const fields = parseCSVLine(headerStr);
  const indexMap = {};
  fields.forEach((field, idx) => {
    indexMap[field.toLowerCase()] = idx;
  });
  return indexMap;
}

// 各セクションのヘッダーインデックスマッピングを作成
const headerIndexMaps = {
  master: sections.master.headerIdx !== null ? createHeaderIndexMap(lines[sections.master.headerIdx]) : {},
  localRemote: sections.localRemote.headerIdx !== null ? createHeaderIndexMap(lines[sections.localRemote.headerIdx]) : {},
  switch: sections.switch.headerIdx !== null ? createHeaderIndexMap(lines[sections.switch.headerIdx]) : {},
  ethernet: sections.ethernet.headerIdx !== null ? createHeaderIndexMap(lines[sections.ethernet.headerIdx]) : {},
  generic: sections.generic.headerIdx !== null ? createHeaderIndexMap(lines[sections.generic.headerIdx]) : {}
};

/**
 * CSV 行をパース
 */
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * CSV フィールドを安全に結合（コンマ含む値はクォート）
 */
function buildCSVLine(fields) {
  return fields.map(field => {
    if (field.includes(',')) {
      return `"${field}"`;
    }
    return field;
  }).join(',');
}

/**
 * CSP からサポートクラスを抽出（複数値の場合は A,B）
 */
function getClassOptions(cspDevice) {
  if (!cspDevice.classOptions) return '';
  if (Array.isArray(cspDevice.classOptions)) {
    return cspDevice.classOptions.sort().join(',');
  }
  return '';
}

/**
 * CSP からサポート速度を抽出（複数値の場合は 1G,100M）
 */
function getSpeedOptions(cspDevice) {
  if (!cspDevice.speedOptions) return '1G'; // デフォルト
  if (Array.isArray(cspDevice.speedOptions)) {
    const sorted = cspDevice.speedOptions.sort((a, b) => {
      if (a === '1G') return -1;
      if (b === '1G') return 1;
      return 0;
    });
    return sorted.join(',');
  }
  return '1G';
}

/**
 * サイクリックデータサイズを計算
 * 計算式: (R_B_DefaultSize ÷ 8) + (R_W_DefaultSize × 2)
 */
function calculateCyclicDataBytes(cspDevice) {
  // r_b_defaultSize と r_w_defaultSize が存在するかチェック（0も有効な値）
  if (cspDevice.r_b_defaultSize === undefined || cspDevice.r_w_defaultSize === undefined) {
    return null; // データ不足の場合は計算不可
  }
  const r_b = parseInt(cspDevice.r_b_defaultSize);
  const r_w = parseInt(cspDevice.r_w_defaultSize);
  if (isNaN(r_b) || isNaN(r_w)) {
    return null;
  }
  const cyclicBytes = Math.floor(r_b / 8) + (r_w * 2);
  return cyclicBytes;
}

/**
 * デバイスの情報を更新（ヘッダー名ベース）
 * 注: speed と speedOptions は CSP データから更新しない（手動設定を保持）
 * 戻り値: { newLine: string, issues: string[] }
 */
function updateDeviceRow(section, deviceObj, cspDevice, headerIndexMap) {
  const fields = parseCSVLine(deviceObj.content);
  const issues = [];
  let changed = false;
  
  // ヘッダーインデックスマッピングから値を取得・設定する関数
  const getFieldIndex = (name) => headerIndexMap[name.toLowerCase()] !== undefined ? headerIndexMap[name.toLowerCase()] : -1;
  const setField = (name, value) => {
    const idx = getFieldIndex(name);
    if (idx >= 0 && fields[idx] !== value) {
      fields[idx] = value;
      changed = true;
    }
  };
  const getField = (name) => {
    const idx = getFieldIndex(name);
    return idx >= 0 ? fields[idx] : null;
  };
  
  if (section === 'localRemote' || section === 'generic') {
    // Local/Remote Devices: deviceId, deviceName, category, defaultClass, deviceClass, 
    //                      cyclicDataBytes, defaultPortCount, minPorts, maxPorts, defaultPortType, 
    //                      supportsOpticalPorts, speed, speedOptions, supportsMulticastFilter, isRingCapable, 
    //                      firmwareVersion, protocolVersion, cycleSetting, notes
    if (fields.length >= 19) {
      setField('deviceName', cspDevice.modelName);
      setField('defaultClass', cspDevice.classDefault || 'A');
      const classOpts = getClassOptions(cspDevice) || cspDevice.classDefault || 'A';
      setField('deviceClass', classOpts);
      // speed & speedOptions -> スキップ（手動設定を保持）
      // category を計算して更新
      const category = normalizeDeviceTypeDetail(cspDevice.deviceTypeDetailRaw);
      setField('category', category);
      // cyclicDataBytes を計算して更新
      const cyclicBytes = calculateCyclicDataBytes(cspDevice);
      if (cyclicBytes !== null) {
        setField('cyclicDataBytes', cyclicBytes.toString());
      } else {
        if (!cspDevice.r_b_defaultSize || !cspDevice.r_w_defaultSize) {
          issues.push('cyclicDataBytes: CSP に r_b_defaultSize/r_w_defaultSize がない');
        }
      }
    }
  } else if (section === 'master') {
    // Master Devices: deviceId, deviceName, category, defaultClass, deviceClass, maxStations, 
    //                defaultPortCount, minPorts, maxPorts, defaultPortType, supportsOpticalPorts, 
    //                speed, speedOptions, supportsMulticastFilter, isRingCapable, firmwareVersion, 
    //                protocolVersion, hardwareVersion, notes
    if (fields.length >= 19) {
      setField('deviceName', cspDevice.modelName);
      setField('defaultClass', cspDevice.classDefault || 'A');
      const classOpts = getClassOptions(cspDevice) || cspDevice.classDefault || 'A';
      setField('deviceClass', classOpts);
      // speed & speedOptions -> スキップ（手動設定を保持）
      // category を計算して更新
      const categoryMaster = normalizeDeviceTypeDetail(cspDevice.deviceTypeDetailRaw);
      setField('category', categoryMaster);
    }
  } else if (section === 'switch') {
    // Switch Devices: deviceId, deviceName, category, defaultPortCount, minPorts, maxPorts, 
    //                defaultPortType, supportsOpticalPorts, switchType, notes
    if (fields.length >= 10) {
      setField('deviceName', cspDevice.modelName);
      const categorySwitch = normalizeDeviceTypeDetail(cspDevice.deviceTypeDetailRaw);
      setField('category', categorySwitch);
    }
  } else if (section === 'ethernet') {
    // Ethernet Devices: deviceId, deviceName, category, defaultPortCount, minPorts, maxPorts, 
    //                  defaultPortType, supportsOpticalPorts, speed, speedOptions, notes
    if (fields.length >= 11) {
      setField('deviceName', cspDevice.modelName);
      // speed & speedOptions -> スキップ（手動設定を保持）
      const categoryEth = normalizeDeviceTypeDetail(cspDevice.deviceTypeDetailRaw);
      setField('category', categoryEth);
    }
  }
  
  return {
    newLine: buildCSVLine(fields),
    issues: issues,
    changed: changed
  };
}

// セクション別に処理
console.log(`\n🔄 CSP 情報で CSV を更新中...`);
let updateCount = 0;
const issuesByDevice = {};

for (const [sectionName, sectionData] of Object.entries(sections)) {
  for (const deviceObj of sectionData.devices) {
    const fields = parseCSVLine(deviceObj.content);
    const deviceId = fields[0];
    
    // deviceId をモデル名として CSP マップを検索
    const cspDevice = cspMap.get(deviceId);
    
    if (cspDevice) {
      const oldLine = deviceObj.content;
      const result = updateDeviceRow(sectionName, deviceObj, cspDevice, headerIndexMaps[sectionName]);
      const newLine = result.newLine;
      
      if (oldLine !== newLine) {
        lines[deviceObj.lineIdx] = newLine;
        updateCount++;
        console.log(`  ✏️  ${deviceId}: ${cspDevice.modelName}`);
      }
      
      // 問題を記録
      if (result.issues.length > 0) {
        issuesByDevice[deviceId] = result.issues;
      }
    }
  }
}

console.log(`✅ ${updateCount} 行を更新`);

// 更新されなかった理由を出力
if (Object.keys(issuesByDevice).length > 0) {
  console.log(`\n⚠️  更新できなかった項目のある機器:`);
  for (const [deviceId, issues] of Object.entries(issuesByDevice)) {
    console.log(`  - ${deviceId}:`);
    for (const issue of issues) {
      console.log(`      • ${issue}`);
    }
  }
}

// CSV を保存（常に UTF-8 BOM + CRLF を使用）
const newLine = useCRLF ? '\r\n' : '\n';
let output = lines.join(newLine);
if (useBOM) output = '\uFEFF' + output;  // BOM を先頭に付加
fs.writeFileSync(csvPath, output, 'utf-8');
console.log(`\n✅ CSV を保存: ${csvPath}`);
console.log(`   📝 形式: ${useBOM ? 'UTF-8 with BOM' : 'UTF-8'}, 改行: ${useCRLF ? 'CRLF' : 'LF'}`);

console.log(`\n✅ cyclicDataBytes を自動計算しました (R_B_DefaultSize と R_W_DefaultSize から)`);
