/**
 * MissionRecorder — telemetría para estudios (IndexedDB + JSONL/CSV export).
 */
const DB_NAME = 'hares-digital-twin';
const STORE = 'missions';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class MissionRecorder {
  constructor() {
    this.active = false;
    this.samples = [];
    this.meta = null;
    this.tickHz = 10;
    this._accum = 0;
  }

  start(meta) {
    this.active = true;
    this.samples = [];
    this._accum = 0;
    this.meta = {
      id: 'mission_' + Date.now(),
      startedAt: new Date().toISOString(),
      ...meta
    };
  }

  stop() {
    this.active = false;
    if (this.meta) this.meta.endedAt = new Date().toISOString();
  }

  push(sample, dt) {
    if (!this.active) return;
    this._accum += dt;
    if (this._accum < 1 / this.tickHz) return;
    this._accum = 0;
    this.samples.push(sample);
  }

  summary() {
    const s = this.samples;
    if (!s.length) {
      return { n: 0, T_lost: 0, D_max: 0, energyUgvEnd: null, energyUavEnd: null };
    }
    let lost = 0;
    let dMax = 0;
    for (const row of s) {
      if (row.d_persona > 40) lost += 1 / this.tickHz;
      if (row.d_persona > dMax) dMax = row.d_persona;
    }
    const last = s[s.length - 1];
    return {
      n: s.length,
      T_lost: +lost.toFixed(2),
      D_max: +dMax.toFixed(2),
      energyUgvEnd: last.ugvBattery,
      energyUavEnd: last.uavBattery,
      durationSec: +((s[s.length - 1].t - s[0].t) / 1000).toFixed(2)
    };
  }

  toJSONL() {
    const header = JSON.stringify({ type: 'meta', ...this.meta, summary: this.summary() });
    const lines = this.samples.map((r) => JSON.stringify({ type: 'sample', ...r }));
    return [header, ...lines].join('\n');
  }

  toCSV() {
    const keys = [
      't', 'scenario', 'controlMode', 'btMode', 'd_persona', 'T_terreno', 'T_fwd',
      'E_bateria', 'R_riesgo', 'C_comunicacion', 'U_incertidumbre', 'deploy_need', 'deploy_gate',
      'locomotion', 'ugvBattery', 'uavBattery', 'actionLabel', 'predLabel', 'confidence', 'event', 'commsOk'
    ];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [keys.join(',')];
    for (const r of this.samples) {
      rows.push(keys.map((k) => escape(r[k])).join(','));
    }
    return rows.join('\n');
  }

  download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  exportAll() {
    const id = (this.meta && this.meta.id) || 'mission';
    this.download(id + '.jsonl', this.toJSONL(), 'application/x-ndjson');
    this.download(id + '.csv', this.toCSV(), 'text/csv');
  }

  async saveLocal() {
    if (!this.meta) return null;
    const record = {
      id: this.meta.id,
      meta: this.meta,
      summary: this.summary(),
      samples: this.samples.slice(-5000)
    };
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return record.id;
  }

  async listMissions() {
    const db = await openDb();
    const list = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return list.map((m) => ({ id: m.id, meta: m.meta, summary: m.summary }));
  }
}
