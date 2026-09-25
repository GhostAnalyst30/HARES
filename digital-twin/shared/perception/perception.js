/**
 * Percepción UAV: muestreo nadir → heightmap + semántica + minimap canvas.
 */
import * as THREE from 'three';

const GRID = 48;
const WORLD_SPAN = 160;

export class PerceptionSystem {
  constructor(scene, world, uav) {
    this.scene = scene;
    this.world = world;
    this.uav = uav;
    this.grid = GRID;
    this.heights = new Float32Array(GRID * GRID);
    this.semantics = new Uint8Array(GRID * GRID); // enum index
    this.confidence = new Float32Array(GRID * GRID);
    this.known = new Uint8Array(GRID * GRID);
    this.scanAccum = 0;
    this.overlayMesh = null;
    this.labels = ['UNKNOWN', 'FLAT', 'SLOPE', 'CLIFF', 'RUBBLE', 'SAND', 'WATER'];
    this._buildOverlay();
  }

  labelIndex(sem) {
    const i = this.labels.indexOf(sem);
    return i < 0 ? 0 : i;
  }

  worldToCell(x, z) {
    const half = WORLD_SPAN / 2;
    const gx = Math.floor(((x + half) / WORLD_SPAN) * this.grid);
    const gz = Math.floor(((z + half) / WORLD_SPAN) * this.grid);
    return {
      gx: Math.max(0, Math.min(this.grid - 1, gx)),
      gz: Math.max(0, Math.min(this.grid - 1, gz))
    };
  }

  cellToWorld(gx, gz) {
    const half = WORLD_SPAN / 2;
    const x = -half + ((gx + 0.5) / this.grid) * WORLD_SPAN;
    const z = -half + ((gz + 0.5) / this.grid) * WORLD_SPAN;
    return { x, z };
  }

  _buildOverlay() {
    const geo = new THREE.PlaneGeometry(WORLD_SPAN, WORLD_SPAN, this.grid - 1, this.grid - 1);
    geo.rotateX(-Math.PI / 2);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.overlayMesh = new THREE.Mesh(geo, mat);
    this.overlayMesh.position.y = 0.8;
    this.overlayMesh.visible = false;
    this.scene.add(this.overlayMesh);
  }

  setOverlayVisible(v) {
    this.overlayMesh.visible = !!v;
  }

  scan(dt, airborne) {
    this.scanAccum += dt;
    if (!airborne || this.scanAccum < 0.12) return;
    this.scanAccum = 0;

    const ux = this.uav.position.x;
    const uz = this.uav.position.z;
    const alt = this.uav.position.y - this.world.heightAt(ux, uz);
    const radius = Math.min(28, 8 + alt * 0.9);
    const step = 3.2;

    for (let dx = -radius; dx <= radius; dx += step) {
      for (let dz = -radius; dz <= radius; dz += step) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const x = ux + dx;
        const z = uz + dz;
        const { gx, gz } = this.worldToCell(x, z);
        const idx = gz * this.grid + gx;
        // raycast proxy: sample true height + noise by altitude/dust
        const noise = (Math.random() - 0.5) * (0.4 + this.world.dustBoost);
        const h = this.world.heightAt(x, z) + noise * 0.15;
        const sem = this.world.semanticAt(x, z);
        const conf = Math.max(0.2, 1 - alt / 50 - this.world.uncertaintyBias());

        // fuse: rising confidence
        if (!this.known[idx] || conf >= this.confidence[idx] * 0.85) {
          this.heights[idx] = h;
          this.semantics[idx] = this.labelIndex(sem);
          this.confidence[idx] = conf;
          this.known[idx] = 1;
        } else {
          this.heights[idx] = this.heights[idx] * 0.7 + h * 0.3;
          this.confidence[idx] = Math.min(1, this.confidence[idx] + 0.05);
        }
      }
    }
    this._updateOverlayMesh();
  }

  _updateOverlayMesh() {
    const pos = this.overlayMesh.geometry.attributes.position;
    const col = this.overlayMesh.geometry.attributes.color;
    const c = new THREE.Color();
    for (let gz = 0; gz < this.grid; gz++) {
      for (let gx = 0; gx < this.grid; gx++) {
        const i = gz * this.grid + gx;
        const { x, z } = this.cellToWorld(gx, gz);
        // PlaneGeometry grid indexing: rows along z
        const vi = i;
        if (this.known[i]) {
          pos.setY(vi, this.heights[i] + 0.6);
          const sem = this.labels[this.semantics[i]];
          if (sem === 'CLIFF') c.setHex(0xe61919);
          else if (sem === 'RUBBLE') c.setHex(0xd4a017);
          else if (sem === 'SLOPE') c.setHex(0xc47a20);
          else if (sem === 'SAND') c.setHex(0xc2a05a);
          else if (sem === 'WATER') c.setHex(0x3a80c0);
          else c.setHex(0x4af626);
          c.multiplyScalar(0.4 + 0.6 * this.confidence[i]);
        } else {
          pos.setY(vi, this.world.heightAt(x, z) + 0.3);
          c.setHex(0x111111);
        }
        col.setXYZ(vi, c.r, c.g, c.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.overlayMesh.geometry.computeVertexNormals();
  }

  /** coverage 0..1 */
  coverage() {
    let n = 0;
    for (let i = 0; i < this.known.length; i++) n += this.known[i];
    return n / this.known.length;
  }

  /**
   * Multiplicador de costo para A* — fusión mapa semántico UAV + T local.
   * base ≈ 1/T; retorna costo de arista efectivo.
   */
  getPathCost(x, z, base, T) {
    const { gx, gz } = this.worldToCell(x, z);
    const idx = gz * this.grid + gx;
    let mult = 1;
    if (this.known[idx]) {
      const sem = this.labels[this.semantics[idx]];
      const conf = this.confidence[idx] || 0.5;
      const table = {
        FLAT: 0.85,
        SLOPE: 1.35,
        SAND: 1.55,
        RUBBLE: 2.4,
        WATER: 3.2,
        CLIFF: 12,
        UNKNOWN: 1.1
      };
      const sm = table[sem] != null ? table[sem] : 1.2;
      // blend: más confianza → más peso semántico
      mult = 1 * (1 - conf) + sm * conf;
      if (sem === 'CLIFF') return base * 20;
    } else {
      // celda no explorada: ligera penalización (incertidumbre espacial)
      mult = 1.25;
    }
    if (T != null && T < 0.25) mult *= 1.8;
    return base * mult;
  }

  /** draw minimap onto 2d canvas */
  drawMinimap(canvas, agents) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    const cellW = w / this.grid;
    const cellH = h / this.grid;
    for (let gz = 0; gz < this.grid; gz++) {
      for (let gx = 0; gx < this.grid; gx++) {
        const i = gz * this.grid + gx;
        if (!this.known[i]) continue;
        const sem = this.labels[this.semantics[i]];
        let color = '#4af626';
        if (sem === 'CLIFF') color = '#e61919';
        else if (sem === 'RUBBLE') color = '#d4a017';
        else if (sem === 'SLOPE') color = '#c47a20';
        else if (sem === 'SAND') color = '#c2a05a';
        else if (sem === 'WATER') color = '#3a80c0';
        ctx.globalAlpha = 0.35 + 0.65 * this.confidence[i];
        ctx.fillStyle = color;
        ctx.fillRect(gx * cellW, gz * cellH, cellW + 0.5, cellH + 0.5);
      }
    }
    ctx.globalAlpha = 1;
    const toPx = (x, z) => {
      const half = WORLD_SPAN / 2;
      return {
        px: ((x + half) / WORLD_SPAN) * w,
        py: ((z + half) / WORLD_SPAN) * h
      };
    };
    if (agents) {
      const drawDot = (x, z, color, r) => {
        const p = toPx(x, z);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fill();
      };
      drawDot(agents.human.x, agents.human.z, '#4af626', 3);
      drawDot(agents.ugv.x, agents.ugv.z, '#7ad4e8', 3);
      drawDot(agents.uav.x, agents.uav.z, '#d4a017', 3);
    }
    ctx.strokeStyle = '#333';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  reset() {
    this.heights.fill(0);
    this.semantics.fill(0);
    this.confidence.fill(0);
    this.known.fill(0);
    this.scanAccum = 0;
    this._updateOverlayMesh();
  }

  snapshot() {
    return {
      grid: this.grid,
      coverage: +this.coverage().toFixed(3),
      knownCount: this.known.reduce((a, b) => a + b, 0),
      heights: Array.from(this.heights),
      semantics: Array.from(this.semantics),
      confidence: Array.from(this.confidence)
    };
  }
}
