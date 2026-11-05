// SPDX-License-Identifier: Apache-2.0
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CSV パース関数
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current) {
    result.push(current.trim());
  }

  return result;
}

async function buildDeviceDefaults() {
  const csvPath = path.resolve(__dirname, '../public/data/device-defaults.csv');
  const outputPath = path.resolve(__dirname, '../public/data/device-defaults.json');
  const srcDataPath = path.resolve(__dirname, '../src/data/device-defaults.json');

  try {
    let csvContent = fs.readFileSync(csvPath, 'utf-8');

    if (csvContent.startsWith('\uFEFF')) {
      csvContent = csvContent.slice(1);
    }

    const allLines = csvContent.split(/\r?\n/);
    const lines = allLines.filter(line => line.trim());

    const sections = {
      master: { name: 'マスタ局', devices: [], fieldMapping: {}, headerIndex: null },
      localRemote: { name: 'ローカル・リモート局', devices: [], fieldMapping: {}, headerIndex: null },
      switch: { name: 'スイッチ', devices: [], fieldMapping: {}, headerIndex: null },
      ethernet: { name: 'イーサネット', devices: [], fieldMapping: {}, headerIndex: null }
    };

    let currentSection = null;

    // ヘッダー行を検出
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('=== Master Devices ===')) {
        currentSection = 'master';
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes('deviceId')) {
            let headerLine = lines[j].trim();
            if (headerLine.startsWith('# ')) headerLine = headerLine.slice(2);
            const fields = parseCSVLine(headerLine);
            fields.forEach((field, idx) => {
              sections.master.fieldMapping[field.toLowerCase()] = idx;
            });
            sections.master.headerIndex = j;
            break;
          }
        }
      } else if (lines[i].includes('=== Local/Remote Devices ===')) {
        currentSection = 'localRemote';
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes('deviceId')) {
            let headerLine = lines[j].trim();
            if (headerLine.startsWith('# ')) headerLine = headerLine.slice(2);
            const fields = parseCSVLine(headerLine);
            fields.forEach((field, idx) => {
              sections.localRemote.fieldMapping[field.toLowerCase()] = idx;
            });
            sections.localRemote.headerIndex = j;
            break;
          }
        }
      } else if (lines[i].includes('=== Switch Devices ===')) {
        currentSection = 'switch';
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes('deviceId')) {
            let headerLine = lines[j].trim();
            if (headerLine.startsWith('# ')) headerLine = headerLine.slice(2);
            const fields = parseCSVLine(headerLine);
            fields.forEach((field, idx) => {
              sections.switch.fieldMapping[field.toLowerCase()] = idx;
            });
            sections.switch.headerIndex = j;
            break;
          }
        }
      } else if (lines[i].includes('=== Ethernet Devices ===')) {
        currentSection = 'ethernet';
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes('deviceId')) {
            let headerLine = lines[j].trim();
            if (headerLine.startsWith('# ')) headerLine = headerLine.slice(2);
            const fields = parseCSVLine(headerLine);
            fields.forEach((field, idx) => {
              sections.ethernet.fieldMapping[field.toLowerCase()] = idx;
            });
            sections.ethernet.headerIndex = j;
            break;
          }
        }
      }
    }

    // データ行を解析
    currentSection = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.includes('=== Master Devices ===')) {
        currentSection = 'master';
        continue;
      }
      if (line.includes('=== Local/Remote Devices ===')) {
        currentSection = 'localRemote';
        continue;
      }
      if (line.includes('=== Switch Devices ===')) {
        currentSection = 'switch';
        continue;
      }
      if (line.includes('=== Ethernet Devices ===')) {
        currentSection = 'ethernet';
        continue;
      }

      if (!currentSection || line.startsWith('#')) continue;
      if (sections[currentSection].headerIndex === i) continue;

      const fields = parseCSVLine(lines[i]);
      if (fields.length === 0 || !fields[0]) continue;

      const section = sections[currentSection];
      const mapping = section.fieldMapping;

      const getField = (name, defaultValue = '') => {
        const idx = mapping[name.toLowerCase()];
        return idx !== undefined && fields[idx] ? fields[idx] : defaultValue;
      };

      const device = {
        deviceId: getField('deviceId'),
        deviceName: getField('deviceName'),
        defaultPortCount: parseInt(getField('defaultPortCount', '0')) || 0,
        minPorts: parseInt(getField('minPorts', '0')) || 0,
        maxPorts: parseInt(getField('maxPorts', '0')) || 0,
        defaultPortType: getField('defaultPortType'),
        supportsOpticalPorts: getField('supportsOpticalPorts') === 'TRUE',
        defaultClass: getField('defaultClass'),
        deviceClass: getField('deviceClass'),
        speed: getField('speed', '1G'),
        speedOptions: getField('speedOptions', '')
          .split(',')
          .map(s => s.trim())
          .filter(s => s),
        supportsMulticastFilter: getField('supportsMulticastFilter') === 'TRUE',
        isRingCapable: getField('isRingCapable') === 'TRUE',
        firmwareVersion: getField('firmwareVersion'),
        protocolVersion: parseInt(getField('protocolVersion', '2')) || 2
      };

      if (currentSection === 'master') {
        device.maxStations = parseInt(getField('maxStations', '0')) || 0;
        device.hardwareVersion = getField('hardwareVersion');
        device.category = getField('category', 'その他');
        device.notes = getField('notes');
      } else if (currentSection === 'localRemote') {
        device.cycleSetting = getField('cycleSetting');
        device.cyclicDataBytes = parseInt(getField('cyclicDataBytes', '0')) || 0;
        device.category = getField('category', 'その他');
        device.notes = getField('notes');
      } else if (currentSection === 'switch') {
        device.category = getField('category', 'その他');
        device.notes = getField('notes');
      } else if (currentSection === 'ethernet') {
        device.category = getField('category', 'その他');
        device.notes = getField('notes');
      }

      section.devices.push(device);
    }

    const output = {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      timestamp: Date.now(),
      master: {
        description: sections.master.name,
        count: sections.master.devices.length,
        devices: sections.master.devices
      },
      localRemote: {
        description: sections.localRemote.name,
        count: sections.localRemote.devices.length,
        devices: sections.localRemote.devices
      },
      switch: {
        description: sections.switch.name,
        count: sections.switch.devices.length,
        devices: sections.switch.devices
      },
      ethernet: {
        description: sections.ethernet.name,
        count: sections.ethernet.devices.length,
        devices: sections.ethernet.devices
      },
      summary: {
        totalDevices:
          sections.master.devices.length +
          sections.localRemote.devices.length +
          sections.switch.devices.length +
          sections.ethernet.devices.length,
        categorizedBy: 'CSP DeviceTypeDetail with fallback to manual entry'
      }
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

    // src/data にもコピー
    fs.copyFileSync(outputPath, srcDataPath);

    console.log('✅ device-defaults.json を生成しました');
    console.log(`   マスタ局: ${sections.master.devices.length} デバイス`);
    console.log(`   ローカル・リモート局: ${sections.localRemote.devices.length} デバイス`);
    console.log(`   スイッチ: ${sections.switch.devices.length} デバイス`);
    console.log(`   イーサネット: ${sections.ethernet.devices.length} デバイス`);
    console.log(`   合計: ${output.summary.totalDevices} デバイス`);
    console.log(`   出力先: ${outputPath}`);
    console.log(`   ✓ src/data/device-defaults.json にもコピーしました`);
  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    process.exit(1);
  }
}

buildDeviceDefaults();
