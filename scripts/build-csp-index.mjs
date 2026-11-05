#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CSP+ preprocessor (multi-zip):
// - Find all ZIPs in tools/csp_raw
// - For each, extract to .tmp/csp/<id>/
// - Choose .cspp file not containing '(CCIEF)' in name
// - Parse XML, read DeviceInformation/DeviceModel as modelName
// - Filter: CommIFInformation/CommIFTypeID/DATA must be 'CCLinkIETSN' (others skipped)
// - Pick an image (PNG > BMP > ICO) and convert to PNG (public/csp/img/<id>.png)
// - Upsert entries in public/csp/csp-index.json

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import sharp from 'sharp';
import bmp from 'bmp-js';
import Jimp from 'jimp';

const ROOT = path.resolve(process.cwd());
const RAW_DIR = path.join(ROOT, 'tools', 'csp_raw');
const TMP_DIR = path.join(ROOT, '.tmp', 'csp');
const PUB_IMG_DIR = path.join(ROOT, 'public', 'csp', 'img');
const INDEX_PATH = path.join(ROOT, 'public', 'csp', 'csp-index.json');

function log(...args) { console.log('[build-csp]', ...args); }

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function listZipFiles() {
  const files = await fsp.readdir(RAW_DIR).catch(() => []);
  const zips = files.filter(f => f.toLowerCase().endsWith('.zip'));
  if (zips.length === 0) return [];
  return zips.map(z => path.join(RAW_DIR, z)).sort();
}


async function extractZip(zipPath, outDir) {
  await ensureDir(outDir);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
}

function findCsppNotCcief(dir) {
  // find files ending with .cspp and name not containing (CCIEF)
  const entries = walkFiles(dir);
  const cspps = entries.filter(p => p.toLowerCase().endsWith('.cspp') && !p.includes('(CCIEF)'));
  if (cspps.length === 0) throw new Error('No non-CCIEF .cspp found');
  return cspps[0];
}

function walkFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const list = fs.readdirSync(d, { withFileTypes: true });
    for (const ent of list) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p); else out.push(p);
    }
  }
  return out;
}

async function parseCspp(csppPath) {
  const xml = await fsp.readFile(csppPath, 'utf-8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });
  const doc = parser.parse(xml);
  const device = doc?.profile?.device;
  
  // DeviceInformationまたはDeviceInfoを探す
  const deviceInfo = Array.isArray(device?.deviceInfo)
    ? (device.deviceInfo.find(d => d?.['@_label'] === 'DeviceInformation') || 
       device.deviceInfo.find(d => d?.['@_label'] === 'DeviceInfo'))
    : (device?.deviceInfo && 
       (device?.deviceInfo?.['@_label'] === 'DeviceInformation' || 
        device?.deviceInfo?.['@_label'] === 'DeviceInfo') ? device.deviceInfo : null);
  
  const members = deviceInfo?.deviceInfoMember
    ? (Array.isArray(deviceInfo.deviceInfoMember) ? deviceInfo.deviceInfoMember : [deviceInfo.deviceInfoMember])
    : [];
  const modelMember = members.find(m => m?.['@_label'] === 'DeviceModel');
  const item = modelMember?.data?.item;
  const modelRaw = Array.isArray(item) ? item[0] : item;
  let modelName = (typeof modelRaw === 'string') ? modelRaw.trim() : undefined;
  
  // DeviceTypeDetail抽出（DeviceInformationまたはDeviceInfoから）
  const typeDetailMember = members.find(m => m?.['@_label'] === 'DeviceTypeDetail');
  let deviceTypeDetailRaw = undefined;
  if (typeDetailMember) {
    let val = typeDetailMember?.data?.item;
    if (Array.isArray(val)) val = val.find(v => typeof v === 'string');
    if (typeof val === 'string') deviceTypeDetailRaw = val.trim();
  }
  
  // Feature抽出（軸数情報のため）
  const featureMember = members.find(m => m?.['@_label'] === 'Feature' || m?.['@_label'] === '特徴');
  let axisCount = undefined;
  if (featureMember) {
    let val = featureMember?.data?.item;
    if (Array.isArray(val)) val = val.find(v => typeof v === 'string');
    if (typeof val === 'string') {
      const featureStr = val.trim();
      // "N軸一体" パターンをマッチング (例: "2軸一体 1～7kW/3相400V")
      const axisMatch = featureStr.match(/(\d+)軸一体/);
      if (axisMatch) {
        axisCount = parseInt(axisMatch[1], 10);
        log('Axis count extracted from Feature:', axisCount);
      }
    }
  }
  
  // DeviceTypeDetail正規化辞書（日本語表現に統一）
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

  function normalizeDeviceTypeDetail(raw) {
    if (!raw) return "その他";
    const key = raw.trim();
    return deviceTypeDetailDict[key] || "その他";
  }
  // Fallback: some legacy CSPP place model under CommIf sections as DevModel / DeviceModel.
  if (!modelName) {
    // Search all commIf sections for commIfInfoMember label DevModel / DeviceModel / ModelName.
    const commIfSections = doc?.profile?.commIf;
    const commIfArray = Array.isArray(commIfSections) ? commIfSections : (commIfSections ? [commIfSections] : []);
    const modelLabels = ['DevModel', 'DeviceModel', 'ModelName'];
    for (const sec of commIfArray) {
      const infos = sec?.commIfInfo;
      const infoArray = Array.isArray(infos) ? infos : (infos ? [infos] : []);
      for (const info of infoArray) {
        const infoMembers = info?.commIfInfoMember ? (Array.isArray(info.commIfInfoMember) ? info.commIfInfoMember : [info.commIfInfoMember]) : [];
        for (const cand of infoMembers) {
          const lbl = cand?.['@_label'];
          if (lbl && modelLabels.includes(lbl)) {
            let val = cand?.data?.item;
            if (Array.isArray(val)) val = val.find(v => typeof v === 'string');
            if (typeof val === 'string' && val.trim()) {
              modelName = val.trim();
              log('modelName fallback via', lbl, '->', modelName);
              break;
            }
          }
        }
        if (modelName) break;
      }
      if (modelName) break;
    }
  }
  if (!modelName) {
    throw new Error('DeviceInformation/DeviceModel not found in cspp (and no fallback DevModel)');
  }

  // CommIFInformation section (structure: profile.device.commIf.commIfInfo[@_label='CommIFInformation'])
  const commIfRoot = doc?.profile?.commIf; // sibling of device, not child
  let classDefault = undefined;
  let classOptions = undefined;
  let speedOptions = undefined;
  let commIfTypeId = undefined;
  let deviceTypeDetailNormalized = undefined;
  let commIfSections = []; // 初期化を追加
  if (commIfRoot) {
    // commIfRoot が配列の場合（複数のcommIfセクション）と単一の場合に対応
    commIfSections = Array.isArray(commIfRoot) ? commIfRoot : [commIfRoot];
    const allInfos = [];
    for (const section of commIfSections) {
      const rawInfos = section?.commIfInfo;
      if (rawInfos) {
        const infoArray = Array.isArray(rawInfos) ? rawInfos : [rawInfos];
        allInfos.push(...infoArray);
      }
    }
    // 全 commIfInfo を走査して、CommIFTypeID やクラス情報を抽出
    for (const info of allInfos) {
      const ciMembers = info?.commIfInfoMember ? (Array.isArray(info.commIfInfoMember) ? info.commIfInfoMember : [info.commIfInfoMember]) : [];
      // CommIFTypeID
      const commIfTypeMember = ciMembers.find(m => m?.['@_label'] === 'CommIFTypeID');
      if (commIfTypeMember && !commIfTypeId) {
        let val = commIfTypeMember?.data?.item;
        if (Array.isArray(val)) val = val.find(v => typeof v === 'string');
        if (typeof val === 'string') commIfTypeId = val.trim();
        log('CommIFTypeID fallback label used:', info?.['@_label']);
      }
      
      // Certification Class / Choice
      const certClassMember = ciMembers.find(m => m?.['@_label'] === 'CertificationClass');
      const certClassChoiceMember = ciMembers.find(m => m?.['@_label'] === 'CertificationClassChoice');
      const rawClass = certClassMember?.data?.item;
      if (!classDefault) {
        if (typeof rawClass === 'string' && (rawClass === 'A' || rawClass === 'B')) classDefault = rawClass;
        if (Array.isArray(rawClass)) {
          const first = rawClass.find(v => v === 'A' || v === 'B');
          if (first) classDefault = first;
        }
      }
      if (!classOptions) {
        const choiceItems = certClassChoiceMember?.data?.item;
        let extracted = [];
        if (typeof choiceItems === 'string') extracted = [choiceItems];
        else if (Array.isArray(choiceItems)) extracted = choiceItems;
        const filtered = extracted.filter(v => v === 'A' || v === 'B');
        if (filtered.length) classOptions = Array.from(new Set(filtered)).sort();
      }
      // Speed capability (受信/中継 両方1で有効と判断)
      const recv1G = ciMembers.find(m => m?.['@_label'] === 'ReceiveFunction1G');
      const relay1G = ciMembers.find(m => m?.['@_label'] === 'RelayFunction1G');
      const recv100 = ciMembers.find(m => m?.['@_label'] === 'ReceiveFunction100M');
      const relay100 = ciMembers.find(m => m?.['@_label'] === 'RelayFunction100M');
      function isEnabled(member) {
        if (!member) return false;
        const it = member?.data?.item;
        if (Array.isArray(it)) return it.some(v => v === '1');
        return it === '1';
      }
      const has1G = isEnabled(recv1G) && isEnabled(relay1G);
      const has100 = isEnabled(recv100) && isEnabled(relay100);
      if (!speedOptions && (has1G || has100)) {
        speedOptions = [];
        if (has100) speedOptions.push('100M');
        if (has1G) speedOptions.push('1G');
      }
      
      // サイクリックデータサイズを抽出（R_B, R_W, S_B, S_W）
      let r_b_defaultSize = undefined;
      let r_w_defaultSize = undefined;
      let s_b_defaultSize = undefined;
      let s_w_defaultSize = undefined;
      
      const r_b_member = ciMembers.find(m => m?.['@_label'] === 'R_B_DefaultSize');
      const r_w_member = ciMembers.find(m => m?.['@_label'] === 'R_W_DefaultSize');
      const s_b_member = ciMembers.find(m => m?.['@_label'] === 'S_B_DefaultSize');
      const s_w_member = ciMembers.find(m => m?.['@_label'] === 'S_W_DefaultSize');
      
      if (r_b_member) {
        const val = r_b_member?.data?.item;
        const num = Array.isArray(val) ? parseInt(val[0]) : parseInt(val);
        if (!isNaN(num)) r_b_defaultSize = num;
      }
      if (r_w_member) {
        const val = r_w_member?.data?.item;
        const num = Array.isArray(val) ? parseInt(val[0]) : parseInt(val);
        if (!isNaN(num)) r_w_defaultSize = num;
      }
      if (s_b_member) {
        const val = s_b_member?.data?.item;
        const num = Array.isArray(val) ? parseInt(val[0]) : parseInt(val);
        if (!isNaN(num)) s_b_defaultSize = num;
      }
      if (s_w_member) {
        const val = s_w_member?.data?.item;
        const num = Array.isArray(val) ? parseInt(val[0]) : parseInt(val);
        if (!isNaN(num)) s_w_defaultSize = num;
      }
      
      if (r_b_defaultSize !== undefined || r_w_defaultSize !== undefined || s_b_defaultSize !== undefined || s_w_defaultSize !== undefined) {
        log('Cyclic data sizes:', { r_b_defaultSize, r_w_defaultSize, s_b_defaultSize, s_w_defaultSize });
        // JSONに格納（commIfSections の最初の要素に一時保存）
        if (commIfSections[0]) {
          if (r_b_defaultSize !== undefined && !commIfSections[0]._r_b_defaultSize) commIfSections[0]._r_b_defaultSize = r_b_defaultSize;
          if (r_w_defaultSize !== undefined && !commIfSections[0]._r_w_defaultSize) commIfSections[0]._r_w_defaultSize = r_w_defaultSize;
          if (s_b_defaultSize !== undefined && !commIfSections[0]._s_b_defaultSize) commIfSections[0]._s_b_defaultSize = s_b_defaultSize;
          if (s_w_defaultSize !== undefined && !commIfSections[0]._s_w_defaultSize) commIfSections[0]._s_w_defaultSize = s_w_defaultSize;
        }
      }
    }
  }
  
  // ブリッジデバイス対応: CommIFTypeIDがない場合、XMLの全体から'CCLinkIETSN'文字列を探す
  if (!commIfTypeId) {
    const xmlStr = JSON.stringify(doc);
    if (xmlStr.includes('CCLinkIETSN') || xmlStr.includes('CCIET')) {
      commIfTypeId = 'CCLinkIETSN';
      log('CommIFTypeID detected from CCLinkIETSN string pattern (bridge device)');
    }
  }
  
  // サイクリックデータサイズを解析結果に追加
  let r_b_defaultSize = commIfSections?.[0]?._r_b_defaultSize;
  let r_w_defaultSize = commIfSections?.[0]?._r_w_defaultSize;
  let s_b_defaultSize = commIfSections?.[0]?._s_b_defaultSize;
  let s_w_defaultSize = commIfSections?.[0]?._s_w_defaultSize;
  
  if (classDefault || classOptions) {
    log('class extracted:', { classDefault, classOptions });
  }
  if (speedOptions) {
    log('speed extracted:', { speedOptions });
  }
  
  // DeviceTypeDetail正規化（CommIFTypeIDチェック後に実行される）
  if (deviceTypeDetailRaw) {
    deviceTypeDetailNormalized = normalizeDeviceTypeDetail(deviceTypeDetailRaw);
  }
  
  return { modelName, classDefault, classOptions, speedOptions, commIfTypeId, deviceTypeDetailRaw, deviceTypeDetailNormalized, r_b_defaultSize, r_w_defaultSize, s_b_defaultSize, s_w_defaultSize, axisCount };
}

function pickBestImage(dir) {
  const files = walkFiles(dir);
  const lower = files.map(p => ({ p, l: p.toLowerCase() }));
  const png = lower.find(e => e.l.endsWith('.png'))?.p;
  if (png) return { path: png, kind: 'png' };
  const bmp = lower.find(e => e.l.endsWith('.bmp'))?.p;
  if (bmp) return { path: bmp, kind: 'bmp' };
  const ico = lower.find(e => e.l.endsWith('.ico'))?.p;
  if (ico) return { path: ico, kind: 'ico' };
  return null;
}

async function convertBmpToPng(srcBmp, outPng) {
  await ensureDir(path.dirname(outPng));
  try {
    // Try native decode first
    const img = sharp(srcBmp);
  const resized = img.resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.nearest });
    await resized.png({ compressionLevel: 9 }).toFile(outPng);
    return;
  } catch (e) {
    // Fallback 2: decode via Jimp (supports BMP incl. palettes)
    try {
      const jimg = await Jimp.read(srcBmp);
      const pngBuf = await jimg.getBufferAsync(Jimp.MIME_PNG);
      const img = sharp(pngBuf);
  const resized = img.resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.nearest });
      await resized.png({ compressionLevel: 9 }).toFile(outPng);
      return;
    } catch (e2) {
      // Final fallback: bmp-js (returns RGBA). No channel swap.
      const buf = await fsp.readFile(srcBmp);
      const decoded = bmp.decode(buf);
      const rgba = Buffer.from(decoded.data);
      const img = sharp(rgba, { raw: { width: decoded.width, height: decoded.height, channels: 4 } });
  const resized = img.resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.nearest });
      await resized.png({ compressionLevel: 9 }).toFile(outPng);
    }
  }
}

async function convertAnyImageToPng(src, kind, outPng) {
  if (kind === 'png') {
    // Normalize and resize PNG
    await ensureDir(path.dirname(outPng));
    await sharp(src)
      .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.nearest })
      .png({ compressionLevel: 9 })
      .toFile(outPng);
    return;
  }
  if (kind === 'bmp') {
    await convertBmpToPng(src, outPng);
    return;
  }
  if (kind === 'ico') {
    try {
      await ensureDir(path.dirname(outPng));
      await sharp(src)
        .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.nearest })
        .png({ compressionLevel: 9 })
        .toFile(outPng);
      return;
    } catch {
      // If ICO unsupported, skip image conversion
      throw new Error('ICO not supported by current decoder');
    }
  }
  throw new Error('Unknown image kind');
}

async function readExistingIndex() {
  try {
    const raw = await fsp.readFile(INDEX_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, generatedAt: new Date().toISOString(), devices: [] };
  }
}

async function writeIndex(index) {
  index.generatedAt = new Date().toISOString();
  await ensureDir(path.dirname(INDEX_PATH));
  await fsp.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
}

async function main() {
  const pruneNonTsn = process.argv.includes('--prune-non-tsn');
  const t0 = Date.now();
  log('start');
  await ensureDir(TMP_DIR);
  const zips = await listZipFiles();
  if (zips.length === 0) {
    log('no zip files found; skipping (nothing to do)');
    return; // not an error; just skip
  }
  const index = await readExistingIndex();
  const acceptedIds = new Set();

  async function processSingleZip(zipPath) {
    const id = path.basename(zipPath).replace(/\.zip$/i, '');
    const workDir = path.join(TMP_DIR, id);
    log('zip:', path.basename(zipPath));
    fs.rmSync(workDir, { recursive: true, force: true });
    await ensureDir(workDir);
    await extractZip(zipPath, workDir);
    // Nested ZIP detection: if no .cspp directly and inner zip(s) exist under CSP+ or root, process them instead.
    let csppPath = null;
    try {
      csppPath = findCsppNotCcief(workDir);
    } catch (e) {
      // Look for inner zips
      const inner = walkFiles(workDir).filter(p => p.toLowerCase().endsWith('.zip'));
      if (inner.length) {
        log('nested zip container detected, expanding inner zips:', inner.map(p => path.relative(workDir, p)).join(', '));
        for (const inZip of inner) {
          try {
            await processSingleZip(inZip); // recursion
          } catch (innerErr) {
            console.error('[build-csp] nested zip error:', path.basename(inZip), innerErr.message || innerErr);
          }
        }
        // Cleanup container workdir after nested processing
        fs.rmSync(workDir, { recursive: true, force: true });
        return; // container itself produces no entry
      } else {
        throw e; // rethrow original error (no cspp & no nested zips)
      }
    }
    log('cspp:', path.relative(workDir, csppPath));
  const { modelName, classDefault, classOptions, speedOptions, commIfTypeId, deviceTypeDetailRaw, deviceTypeDetailNormalized, r_b_defaultSize, r_w_defaultSize, s_b_defaultSize, s_w_defaultSize, axisCount } = await parseCspp(csppPath);
    if (commIfTypeId !== 'CCLinkIETSN') {
      log('skip (CommIFTypeID not CCLinkIETSN):', commIfTypeId || '(missing)');
      fs.rmSync(workDir, { recursive: true, force: true });
      return;
    }
    log('modelName:', modelName);
    const imgCand = pickBestImage(workDir);
    let imageRel = undefined;
    if (imgCand) {
      const outPng = path.join(PUB_IMG_DIR, id + '.png');
      try {
        await convertAnyImageToPng(imgCand.path, imgCand.kind, outPng);
        imageRel = `csp/img/${id}.png`;
        log('image:', path.relative(workDir, imgCand.path), '->', path.relative(ROOT, outPng));
      } catch (e) {
        console.warn('[build-csp] image convert skipped:', String(e));
      }
    } else {
      console.warn('[build-csp] no image found in', path.basename(zipPath));
    }
    const entry = {
      id,
      modelName,
      ...(imageRel ? { image: imageRel } : {}),
      ...(classDefault ? { classDefault } : {}),
      ...(classOptions ? { classOptions } : {}),
      ...(speedOptions ? { speedOptions } : {}),
      commIfTypeId,
      ...(deviceTypeDetailRaw ? { deviceTypeDetailRaw } : {}),
      ...(deviceTypeDetailNormalized ? { deviceTypeDetailNormalized } : {}),
      ...(r_b_defaultSize !== undefined ? { r_b_defaultSize } : {}),
      ...(r_w_defaultSize !== undefined ? { r_w_defaultSize } : {}),
      ...(s_b_defaultSize !== undefined ? { s_b_defaultSize } : {}),
      ...(s_w_defaultSize !== undefined ? { s_w_defaultSize } : {}),
      ...(axisCount !== undefined ? { axisCount } : {})
    };
    const i = index.devices.findIndex(d => d.id === id);
    if (i >= 0) index.devices[i] = entry; else index.devices.push(entry);
    acceptedIds.add(id);
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  for (const zipPath of zips) {
    try {
      await processSingleZip(zipPath);
    } catch (err) {
      console.error('[build-csp] error in', path.basename(zipPath) + ':', err.message || err);
      continue;
    }
  }
  if (pruneNonTsn) {
    const before = index.devices.length;
    index.devices = index.devices.filter(d => acceptedIds.has(d.id));
    log('prune-non-tsn applied. devices before:', before, 'after:', index.devices.length);
  }
  await writeIndex(index);
  const ms = Date.now() - t0;
  log('done. wrote', path.relative(ROOT, INDEX_PATH), 'and images under', path.relative(ROOT, PUB_IMG_DIR), 'elapsed(ms):', ms);
}

main().catch(err => {
  console.error('[build-csp] error:', err);
  process.exit(1);
});
