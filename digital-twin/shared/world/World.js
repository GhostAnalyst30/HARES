/**
 * Mundo: heightfield, transitabilidad T, sólidos, rough zones, eventos dinámicos.
 */
import * as THREE from 'three';
import { SCENARIOS } from './scenarios.js';

export const WORLD_BOUNDS = { minX: -140, minY: -140, maxX: 140, maxY: 140 };

export class World {
  constructor(scene) {
    this.scene = scene;
    this.scenarioId = 'slope';
    this.scenario = SCENARIOS.slope;
    this.solids = [];
    this.rough = [];
    this.envGroup = new THREE.Group();
    this.debrisGroup = new THREE.Group();
    this.terrainMesh = null;
    this.missionTime = 0;
    this.commsOk = true;
    this.shakeIntensity = 0;
    this.dustBoost = 0;
    this.collapsed = new Set();
    this.eventLog = [];
    this.TOverrides = []; // dynamic rubble patches {x,z,r,T}
    scene.add(this.envGroup);
    scene.add(this.debrisGroup);
  }

  heightAt(x, z) {
    return this.scenario.heightFn(x, z);
  }

  slopeAt(x, z) {
    const e = 1.6;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  isCliff(x, z) {
    return this.slopeAt(x, z) > 1.22;
  }

  xzIn(x, z, b, pad = 0) {
    return x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad;
  }

  isSolidXZ(x, z, pad = 1.6) {
    if (this.isCliff(x, z)) return true;
    for (const s of this.solids) {
      if (s.collapsed) continue;
      if (this.xzIn(x, z, s, pad)) return true;
    }
    return false;
  }

  getT(x, z) {
    for (const o of this.TOverrides) {
      const d = Math.hypot(x - o.x, z - o.z);
      if (d < o.r) return Math.min(o.T, 0.22);
    }
    if (this.isCliff(x, z)) return 0;
    for (const s of this.solids) {
      if (s.collapsed) continue;
      if (this.xzIn(x, z, s, 1.2)) return 0;
    }
    for (const r of this.rough) {
      if (this.xzIn(x, z, r, 0)) return r.T;
    }
    const slope = this.slopeAt(x, z);
    if (slope > 1.22) return 0;
    if (slope > 0.52) return 0.22;
    if (slope > 0.28) return 0.48;
    return Math.max(0.72, 0.98 - slope * 0.55);
  }

  semanticAt(x, z) {
    const T = this.getT(x, z);
    const slope = this.slopeAt(x, z);
    return this.scenario.semanticAt(x, z, slope, T);
  }

  disposeGroup(g) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
      }
    }
  }

  addSolidMesh(def) {
    const w = def.maxX - def.minX;
    const d = def.maxZ - def.minZ;
    const cx = (def.minX + def.maxX) / 2;
    const cz = (def.minZ + def.maxZ) / 2;
    const h = def.h || 8;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color: 0x2a1a14,
        roughness: 0.88,
        metalness: 0.05
      })
    );
    mesh.position.set(cx, this.heightAt(cx, cz) + h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.solid = def;
    this.envGroup.add(mesh);
    def.mesh = mesh;
    def.collapsed = false;
    this.solids.push(def);
  }

  createTerrain() {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.material.dispose();
      this.terrainMesh = null;
    }
    const SEG = 128;
    const SIZE = 360;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const T = this.getT(x, z);
      const sem = this.semanticAt(x, z);
      if (sem === 'WATER') c.setHex(0x1a3040);
      else if (sem === 'SAND') c.setHex(0x6a5428);
      else if (sem === 'RUBBLE') c.setHex(0x4a3830);
      else if (sem === 'CLIFF' || T < 0.08) c.setHex(0x3a1410);
      else if (sem === 'SLOPE' || T < 0.4) c.setHex(0x5a4830);
      else if (y > 7) c.setHex(0x4a443c);
      else c.setHex(0x2c382c);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.terrainMesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.04
      })
    );
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  loadScenario(id) {
    const sc = SCENARIOS[id] || SCENARIOS.slope;
    this.scenarioId = sc.id;
    this.scenario = sc;
    this.missionTime = 0;
    this.commsOk = true;
    this.shakeIntensity = 0;
    this.dustBoost = 0;
    this.collapsed.clear();
    this.eventLog = [];
    this.TOverrides = [];
    this.disposeGroup(this.envGroup);
    this.disposeGroup(this.debrisGroup);
    this.solids = [];
    this.rough = (sc.roughZones || []).map((r) => ({ ...r }));
    this.createTerrain();
    for (const s of sc.solids || []) {
      this.addSolidMesh({ ...s });
    }
    this.scene.background = new THREE.Color(sc.sky);
    this.scene.fog = new THREE.Fog(sc.fogColor, sc.fogNear, sc.fogFar);
    return sc;
  }

  spawnRubble(cx, cz, count = 8) {
    for (let i = 0; i < count; i++) {
      const size = 1.2 + Math.random() * 2.5;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 0.7, size * 0.9),
        new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.95 })
      );
      const ox = cx + (Math.random() - 0.5) * 14;
      const oz = cz + (Math.random() - 0.5) * 14;
      mesh.position.set(ox, this.heightAt(ox, oz) + size * 0.35, oz);
      mesh.rotation.set(Math.random(), Math.random(), Math.random());
      mesh.castShadow = true;
      this.debrisGroup.add(mesh);
      this.TOverrides.push({ x: ox, z: oz, r: 4 + Math.random() * 3, T: 0.18 });
    }
  }

  collapseSolid(def) {
    if (!def || def.collapsed) return;
    def.collapsed = true;
    if (def.mesh) {
      def.mesh.visible = false;
    }
    const cx = (def.minX + def.maxX) / 2;
    const cz = (def.minZ + def.maxZ) / 2;
    this.spawnRubble(cx, cz, 10);
    this.eventLog.push({ t: this.missionTime, type: 'collapse', x: cx, z: cz });
  }

  update(dt) {
    this.missionTime += dt;
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 0.35);
    this.dustBoost = Math.max(0, this.dustBoost - dt * 0.05);

    const events = this.scenario.events || [];
    for (const ev of events) {
      const key = ev.t + ':' + ev.type;
      if (this.collapsed.has(key)) continue;
      if (this.missionTime >= ev.t && this.missionTime < ev.t + 0.2) {
        this.collapsed.add(key);
        if (ev.type === 'shake') {
          this.shakeIntensity = ev.intensity || 0.5;
          this.eventLog.push({ t: this.missionTime, type: 'shake' });
        } else if (ev.type === 'collapse') {
          this.shakeIntensity = Math.max(this.shakeIntensity, 0.8);
          const pending = this.solids.filter((s) => !s.collapsed && s.collapseAt != null);
          const target = pending.find((s) => Math.abs(s.collapseAt - ev.t) < 2) || pending[0];
          if (target) this.collapseSolid(target);
        } else if (ev.type === 'comms_drop') {
          this.commsOk = false;
          this._commsRestoreAt = this.missionTime + (ev.duration || 10);
          this.eventLog.push({ t: this.missionTime, type: 'comms_drop' });
        } else if (ev.type === 'dust_storm') {
          this.dustBoost = ev.intensity || 0.7;
          this.eventLog.push({ t: this.missionTime, type: 'dust_storm' });
        }
      }
    }
    if (this._commsRestoreAt && this.missionTime >= this._commsRestoreAt) {
      this.commsOk = true;
      this._commsRestoreAt = null;
      this.eventLog.push({ t: this.missionTime, type: 'comms_restore' });
    }
  }

  uncertaintyBias() {
    return (this.scenario.uncertaintyBias || 0) + this.dustBoost * 0.4 + (this.commsOk ? 0 : 0.25);
  }

  getShakeOffset() {
    if (this.shakeIntensity <= 0) return { x: 0, y: 0 };
    const i = this.shakeIntensity;
    return {
      x: (Math.random() - 0.5) * i * 2.2,
      y: (Math.random() - 0.5) * i * 1.4
    };
  }
}
