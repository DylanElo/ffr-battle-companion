// Save format: port of SaveFile.cs, Properties.cs, SaveStructure.cs, Unlocks.cs and Artifacts.cs.
// Pure functions over Uint8Array; runs in the browser and in Node (for test/save.test.mjs).

const KEY = new TextEncoder().encode('wwrqPkdwzPvgfchQ8kTYHVbn4umTf3d7');
const utf8 = new TextDecoder('utf-8', { fatal: true }), utf16 = new TextDecoder('utf-16le', { fatal: true });
const subtle = globalThis.crypto.subtle;
let aesKeys;
const keys = () => aesKeys ??= Promise.all([
  subtle.importKey('raw', KEY, 'AES-CBC', false, ['encrypt', 'decrypt']),
  subtle.importKey('raw', KEY, 'AES-CTR', false, ['encrypt'])]);

const fail = m => { throw new Error(m); };
const i32 = (b, o) => new DataView(b.buffer, b.byteOffset).getInt32(o, true);
const setI32 = (b, o, v) => new DataView(b.buffer, b.byteOffset).setInt32(o, v, true);
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const int = v => { const b = new Uint8Array(4); setI32(b, 0, v); return b; };
const sha1 = async b => new Uint8Array(await subtle.digest('SHA-1', b));

// ---------- encryption wrapper (SVHD header + AES-256-ECB, SHA1 of ciphertext) ----------

export async function openSave(original) {
  const dv = new DataView(original.buffer, original.byteOffset);
  if (original.length < 48 || original.length % 16 || String.fromCharCode(...original.subarray(0, 4)) !== 'SVHD'
    || dv.getUint32(4, true) !== 0x10001 || dv.getUint32(28, true) !== 0)
    fail('This is not a FINAL FANTASY RESONANCE game save.');
  const cipher = original.subarray(32);
  if (!eq(await sha1(cipher), original.subarray(8, 28)))
    fail('The save failed its integrity check. It may be damaged — try a backup.');
  // WebCrypto has no ECB. CBC-decrypt with a forged final padding block, then undo the chaining XOR.
  const [cbc] = await keys(), last = cipher.subarray(cipher.length - 16);
  const pad = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: last }, cbc, new Uint8Array(16).fill(16))).subarray(0, 16);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, cbc, cat(cipher, pad)));
  for (let i = 16; i < plain.length; i++) plain[i] ^= cipher[i - 16];
  if (String.fromCharCode(...plain.subarray(0, 4)) !== 'GVAS') fail('The save could not be decrypted.');
  return { original, data: plain };
}

export async function encodeSave(save, data) {
  const logical = inspect(data).logicalLength;
  // Native saves end with four GVAS zero bytes, then 1..16 AES zero-padding bytes; unchanged sizes round-trip exactly.
  const length = data.length === save.data.length ? data.length : (Math.floor((logical + 4) / 16) + 1) * 16;
  const padded = new Uint8Array(length); padded.set(data.subarray(0, logical));
  // ECB encrypt one block at a time: AES-CTR of zeros with counter = block gives E(block).
  const [, ctr] = await keys(), zero = new Uint8Array(16);
  const blocks = await Promise.all(Array.from({ length: length / 16 }, (_, i) =>
    subtle.encrypt({ name: 'AES-CTR', counter: padded.subarray(i * 16, i * 16 + 16), length: 128 }, ctr, zero)));
  const cipher = cat(...blocks.map(b => new Uint8Array(b)));
  const out = cat(save.original.subarray(0, 32), cipher);
  out.set(await sha1(cipher), 8);
  const check = await openSave(out); parse(check.data);
  return out;
}

// ---------- GVAS tagged-property reader ----------

export const parse = data => inspect(data).fields;

export function inspect(data) {
  if (data.length < 42 || String.fromCharCode(...data.subarray(0, 4)) !== 'GVAS') fail('Invalid GVAS header.');
  const dv = new DataView(data.buffer, data.byteOffset, data.length);
  const fields = [], payloads = [], arrays = [];
  let pos = 0;
  const need = n => { if (n < 0 || n > data.length - pos) fail(`Truncated save at 0x${pos.toString(16)}.`); };
  const skip = n => { need(n); pos += n; };
  const byte = () => { need(1); return data[pos++]; };
  const readInt = () => { need(4); const n = dv.getInt32(pos, true); pos += 4; return n; };
  const count = () => { const n = readInt(); if (n < 0 || n > 1e6) fail('Invalid collection size.'); return n; };
  const str = () => {
    const n = readInt(); if (n === 0) return '';
    if (n === -2147483648) fail('Invalid string length.');
    const wide = n < 0, bytes = Math.abs(n) * (wide ? 2 : 1); need(bytes);
    if (bytes > 1e6 || data[pos + bytes - 1] !== 0 || (wide && data[pos + bytes - 2] !== 0)) fail('Invalid save string.');
    const s = (wide ? utf16 : utf8).decode(data.subarray(pos, pos + bytes - (wide ? 2 : 1)));
    pos += bytes; return s;
  };
  const type = depth => {
    if (depth > 16) fail('Property type nesting is too deep.');
    const name = str(), n = count(); if (n > 16) fail('Invalid property type.');
    const children = []; for (let i = 0; i < n; i++) children.push(type(depth + 1));
    return { name, children };
  };
  const scalar = (path, t, size, read) => { const offset = pos; need(size); const value = read(offset); pos += size; fields.push({ path, type: t, offset, size, value }); };
  const tagged = (path, end, depth) => {
    if (depth > 64) fail('Property nesting is too deep.');
    while (pos < end) {
      const name = str(); if (name === 'None') return;
      if (!name) fail('Empty property name.');
      const kind = type(0), sizeOffset = pos, size = count(), flagOffset = pos, flags = byte();
      if (flags & 0xC0) fail('Unsupported property flags.');
      let fieldPath = path ? path + '.' + name : name;
      if (flags & 1) fieldPath += '[' + readInt() + ']';
      if (flags & 2) skip(16);
      if (flags & 4) fail('Unsupported property extensions.');
      const payloadEnd = pos + size;
      if (payloadEnd > end) fail(`Invalid property size: ${fieldPath}.`);
      payloads.push({ sizeOffset, start: pos, end: payloadEnd, path: fieldPath, type: kind.name });
      if (kind.name === 'BoolProperty') fields.push({ path: fieldPath, type: 'BoolProperty', offset: flagOffset, size: 0, value: (flags & 16) !== 0 });
      else value(fieldPath, kind, payloadEnd, depth + 1, size, (flags & 8) !== 0);
      if (pos !== payloadEnd) fail(`Property size mismatch: ${fieldPath}.`);
    }
    fail(`Missing property terminator: ${path}.`);
  };
  const value = (path, kind, end, depth, size = -1, native = false) => {
    if (depth > 64) fail('Property nesting is too deep.');
    const k = kind.name;
    switch (k) {
      case 'IntProperty': return scalar(path, k, 4, o => dv.getInt32(o, true));
      case 'UInt32Property': return scalar(path, k, 4, o => dv.getUint32(o, true));
      case 'Int64Property': return scalar(path, k, 8, o => dv.getBigInt64(o, true));
      case 'UInt64Property': return scalar(path, k, 8, o => dv.getBigUint64(o, true));
      case 'FloatProperty': return scalar(path, k, 4, o => dv.getFloat32(o, true));
      case 'DoubleProperty': return scalar(path, k, 8, o => dv.getFloat64(o, true));
      case 'BoolProperty': return scalar(path, 'ByteBool', 1, o => data[o] !== 0);
      case 'ByteProperty': if (!kind.children.length) return scalar(path, k, 1, o => data[o]);
      // falls through: enum-typed byte is stored as a name
      case 'EnumProperty': case 'NameProperty': case 'StrProperty': {
        const offset = pos, v = str(); fields.push({ path, type: k, offset, size: pos - offset, value: v }); return;
      }
      case 'StructProperty': {
        if (kind.children.length !== 1) fail('Invalid struct type.');
        const s = kind.children[0].name;
        if (s === 'DateTime') scalar(path, 'Int64Property', 8, o => dv.getBigInt64(o, true));
        else if (s === 'Vector') for (const axis of 'XYZ') scalar(path + '.' + axis, 'DoubleProperty', 8, o => dv.getFloat64(o, true));
        else if (native) { if (size < 0) fail('Unknown native struct.'); skip(size); }
        else tagged(path, end, depth + 1);
        return;
      }
      case 'ArrayProperty': case 'SetProperty': {
        if (kind.children.length !== 1) fail('Invalid array type.');
        if (k === 'SetProperty' && count() !== 0) fail('Unsupported removed set entries.');
        const countOffset = pos, n = count(), records = [];
        for (let i = 0; i < n; i++) {
          const start = pos;
          value(`${path}[${i}]`, kind.children[0], end, depth + 1);
          if (pos > end) fail('Array exceeded property size.');
          records.push({ offset: start, length: pos - start });
        }
        if (k === 'ArrayProperty' && kind.children[0].name === 'StructProperty') arrays.push({ path, count: n, records, countOffset, endOffset: pos });
        return;
      }
      case 'MapProperty': {
        if (kind.children.length !== 2) fail('Invalid map type.');
        if (count() !== 0) fail('Unsupported removed map entries.');
        const n = count();
        for (let i = 0; i < n; i++) {
          value(`${path}[${i}].Key`, kind.children[0], end, depth + 1);
          value(`${path}[${i}].Value`, kind.children[1], end, depth + 1);
          if (pos > end) fail('Map exceeded property size.');
        }
        return;
      }
      default:
        if (size < 0) fail(`Unsupported collection type ${k}.`);
        skip(size);
    }
  };

  skip(4);
  if (readInt() !== 3) fail('Unsupported GVAS version.');
  skip(8 + 6 + 4); str();
  if (readInt() !== 3) fail('Unsupported custom-version format.');
  skip(count() * 20); str();
  if (byte() !== 0) fail('Unsupported class header.');
  tagged('', data.length, 0);
  for (let i = pos; i < data.length; i++) if (data[i]) fail('Unexpected trailing save data.');
  return { fields, payloads, arrays, logicalLength: pos };
}

// ---------- structural edits ----------

function splice(data, offset, removed, replacement, containers) {
  const delta = replacement.length - removed;
  const out = cat(data.subarray(0, offset), replacement, data.subarray(offset + removed));
  for (const p of containers) setI32(out, p.sizeOffset, p.end - p.start + delta);
  return out;
}

function appendRoot(data, tagged) {
  const end = inspect(data).logicalLength, offset = end - 9;
  if (!tagged.length || offset < 0 || !eq(data.subarray(offset, end), fstr('None'))) fail('Unsupported root property terminator.');
  const out = splice(data, offset, 0, tagged, []); parse(out); return out;
}

function appendRecord(data, arrayPath, record) {
  const layout = inspect(data), array = layout.arrays.find(a => a.path === arrayPath) ?? fail('No array ' + arrayPath);
  const out = splice(data, array.endOffset, 0, record, layout.payloads.filter(p => p.start <= array.countOffset && p.end >= array.endOffset));
  setI32(out, array.countOffset, array.count + 1);
  const added = inspect(out).arrays.find(a => a.path === arrayPath);
  if (added.count !== array.count + 1 || added.records.at(-1).length !== record.length) fail('The new record does not match the array structure.');
  return out;
}

function replaceRange(data, start, end, replacement) {
  const layout = inspect(data);
  const out = splice(data, start, end - start, replacement, layout.payloads.filter(p => p.start <= start && p.end >= end));
  parse(out); return out;
}

const fstr = s => { const b = new TextEncoder().encode(s + '\0'); return cat(int(b.length), b); };
const typeTree = (name, ...children) => cat(fstr(name), int(children.length), ...children);
const tag = (name, type, payload, flags = 0) => cat(fstr(name), type, int(payload.length), Uint8Array.of(flags), payload);
const intField = (name, v) => tag(name, typeTree('IntProperty'), int(v));
const structArray = struct => typeTree('ArrayProperty', typeTree('StructProperty', typeTree(struct, typeTree('/Script/mucha'))));
const itemRecord = (id, qty) => cat(intField('ItemId', id), intField('Num', qty), fstr('None'));
const prefixOf = (f, key) => f.path.slice(0, -key.length);
const byPath = fields => new Map(fields.map(f => [f.path, f]));

// ---------- scalar fields ----------

export const editable = f => ['IntProperty', 'UInt32Property', 'Int64Property', 'UInt64Property', 'FloatProperty', 'DoubleProperty', 'BoolProperty', 'ByteBool'].includes(f.type)
  || (f.type === 'ByteProperty' && f.size === 1);

/** Writes a text value into a copy of data at field f. Throws a readable error on invalid input. */
export function writeField(data, f, text) {
  const out = data.slice(), dv = new DataView(out.buffer);
  text = String(text).trim();
  const bool = () => text === 'true' ? true : text === 'false' ? false : fail('Use true or false.');
  const whole = (min, max) => {
    if (!/^-?\d+$/.test(text)) fail('Use a whole number.');
    const v = BigInt(text); if (v < min || v > max) fail(`Use a number from ${min} to ${max}.`); return v;
  };
  const real = () => { const v = Number(text); if (text === '' || !Number.isFinite(v)) fail('Use a finite number.'); return v; };
  switch (f.type) {
    case 'BoolProperty': if (f.size === 0) { out[f.offset] = (out[f.offset] & ~16) | (bool() ? 16 : 0); break; }
    // falls through
    case 'ByteBool': out[f.offset] = bool() ? 1 : 0; break;
    case 'IntProperty': dv.setInt32(f.offset, Number(whole(-(2n ** 31n), 2n ** 31n - 1n)), true); break;
    case 'UInt32Property': dv.setUint32(f.offset, Number(whole(0n, 2n ** 32n - 1n)), true); break;
    case 'Int64Property': dv.setBigInt64(f.offset, whole(-(2n ** 63n), 2n ** 63n - 1n), true); break;
    case 'UInt64Property': dv.setBigUint64(f.offset, whole(0n, 2n ** 64n - 1n), true); break;
    case 'FloatProperty': { const v = real(); if (!Number.isFinite(Math.fround(v))) fail('Number is too large.'); dv.setFloat32(f.offset, v, true); break; }
    case 'DoubleProperty': dv.setFloat64(f.offset, real(), true); break;
    case 'ByteProperty': if (f.size === 1) { out[f.offset] = Number(whole(0n, 255n)); break; }
    // falls through
    default: fail('This field cannot be edited.');
  }
  return out;
}

// ---------- unlocks: items, Resonances, characters ----------

const LOCATIONS = { Character: ['unitParameterList', 'UnitId'], Resonance: ['visionList', 'ID'], Item: ['inventory', 'ItemId'] };
const inList = (f, array, key) => f.path.startsWith(array + '[') && f.path.endsWith('.' + key);

export function ownedIds(data, kind) {
  const fields = parse(data), map = byPath(fields), [array, key] = LOCATIONS[kind];
  return new Set(fields.filter(f => inList(f, array, key)).filter(f => {
    const p = prefixOf(f, key);
    if (kind === 'Character') return map.get(p + 'JoinStatus')?.value === 'eUnitJoinStatus::Join' && map.get(p + 'IsUsable')?.value === true;
    if (kind === 'Item') return map.get(p + 'Num')?.value > 0;
    return true;
  }).map(f => f.value));
}

/** Adds or unlocks a catalog entry. `catalog` is unlock-catalog.json. Port of Unlocks.Add. */
export function unlock(data, catalog, kind, id, quantity = 1) {
  if (!catalog[kind]?.some(o => o.Id === id)) fail('That entry is not in the verified catalog.');
  if (!(quantity >= 1 && quantity <= 999)) fail('Quantity must be from 1 to 999.');
  const [array, key] = LOCATIONS[kind], fields = parse(data);
  const existing = fields.find(f => inList(f, array, key) && f.value === id);
  let out = data.slice();
  if (kind === 'Character') {
    // Native playable characters already have an initialized record, even before joining.
    if (!existing) fail('This save has no record for that character yet.');
    const p = prefixOf(existing, key), status = fields.find(f => f.path === p + 'JoinStatus');
    out = replaceRange(out, status.offset, status.offset + status.size, fstr('eUnitJoinStatus::Join'));
    out[parse(out).find(f => f.path === p + 'IsUsable').offset] |= 16;
  } else if (kind === 'Item' && existing) {
    setI32(out, fields.find(f => f.path === prefixOf(existing, key) + 'Num').offset, quantity);
  } else if (!existing) {
    const record = kind === 'Item' ? itemRecord(id, quantity) : resonanceRecord(id);
    out = inspect(out).arrays.some(a => a.path === array) ? appendRecord(out, array, record)
      // Early saves omit never-used collections; these are the game's reflected struct names.
      : appendRoot(out, tag(array, structArray(kind === 'Item' ? 'SaveData_Inventory' : 'SaveData_Vision'), cat(int(1), record)));
  }
  parse(out);
  return out;
}

function resonanceRecord(id) {
  const intType = typeTree('IntProperty'), mapType = cat(fstr('MapProperty'), int(2), intType, intType);
  const chars = [1001, 1002, 1003, 1006, 1004, 1005, 1007, 1008];
  const payload = cat(int(0), int(chars.length), ...chars.flatMap(c => [int(c), int(0)]));
  return cat(intField('ID', id), intField('awakeningPoint', 0), tag('synchroPoints', mapType, payload), fstr('None'));
}

// ---------- artifacts: ownership lives in inventory, activation in artifactList ----------

const artifactKey = (fields, id) => fields.find(f => f.path.startsWith('artifactList[') && f.path.endsWith('.Key') && f.value === id);

export function ownedArtifacts(data, artifacts) {
  const fields = parse(data), map = byPath(fields), ids = new Set(artifacts.map(a => a.Id));
  return new Set(fields.filter(f => inList(f, 'inventory', 'ItemId') && ids.has(f.value) && map.get(prefixOf(f, 'ItemId') + 'Num').value > 0).map(f => f.value));
}

export function artifactActive(data, artifacts, id) {
  const a = artifacts.find(o => o.Id === id) ?? fail('Unknown artifact.');
  if (!ownedArtifacts(data, artifacts).has(id)) return false;
  const fields = parse(data), k = artifactKey(fields, id);
  return k ? fields.find(f => f.path === k.path.slice(0, -3) + 'Value.IsActive').value : a.InitialActive;
}

/** Owns the artifact (quantity 1 if missing) and sets its effect on or off. Port of Artifacts.Set. */
export function setArtifact(data, artifacts, id, active) {
  if (!artifacts.some(o => o.Id === id)) fail('Unknown artifact.');
  let out = data.slice();
  if (!ownedArtifacts(out, artifacts).has(id)) {
    const fields = parse(out), slot = fields.find(f => inList(f, 'inventory', 'ItemId') && f.value === id);
    if (slot) setI32(out, fields.find(f => f.path === prefixOf(slot, 'ItemId') + 'Num').offset, 1);
    else out = inspect(out).arrays.some(a => a.path === 'inventory') ? appendRecord(out, 'inventory', itemRecord(id, 1))
      : appendRoot(out, tag('inventory', structArray('SaveData_Inventory'), cat(int(1), itemRecord(id, 1))));
  }
  const layout = inspect(out), k = artifactKey(layout.fields, id);
  if (k) {
    const flag = layout.fields.find(f => f.path === k.path.slice(0, -3) + 'Value.IsActive');
    out[flag.offset] = active ? out[flag.offset] | 16 : out[flag.offset] & 0xEF;
  } else {
    // artifactList is Map<int, SaveData_Artifact>; the struct's only field is a tagged IsActive.
    const entry = cat(int(id), tag('IsActive', typeTree('BoolProperty'), new Uint8Array(0), active ? 16 : 0), fstr('None'));
    const map = layout.payloads.find(p => p.path === 'artifactList');
    if (map) {
      if (map.type !== 'MapProperty' || map.end - map.start < 8 || i32(out, map.start) !== 0) fail('Unsupported artifact map.');
      const payload = cat(out.subarray(map.start, map.end), entry);
      setI32(payload, 4, i32(payload, 4) + 1);
      out = replaceRange(out, map.start, map.end, payload);
    } else out = appendRoot(out, tag('artifactList',
      typeTree('MapProperty', typeTree('IntProperty'), typeTree('StructProperty', typeTree('SaveData_Artifact', typeTree('/Script/mucha')))),
      cat(int(0), int(1), entry)));
  }
  if (!ownedArtifacts(out, artifacts).has(id) || artifactActive(out, artifacts, id) !== active) fail('Artifact change did not round-trip.');
  return out;
}
