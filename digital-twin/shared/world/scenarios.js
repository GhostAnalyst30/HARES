/**
 * Escenarios del Digital Twin — cada uno define relieve, sólidos, rough, eventos y atmósfera.
 */
import * as THREE from 'three';

export const SCENARIOS = {
  slope: {
    id: 'slope',
    name: 'Pendiente / Cañón',
    fogNear: 90,
    fogFar: 420,
    fogColor: 0x070707,
    sky: 0x070707,
    dust: 0.15,
    uncertaintyBias: 0.05,
    heightFn(x, z) {
      let h = 1.7 * Math.sin(x * 0.028) * Math.cos(z * 0.024);
      h += 1.15 * Math.sin(x * 0.07 + 0.8) * Math.sin(z * 0.055);
      h += 0.5 * Math.sin(x * 0.15 + z * 0.12);
      const pass = THREE.MathUtils.smoothstep(40, 64, x);
      const ridge = Math.exp(-((z / 8.2) * (z / 8.2)));
      h += (14.2 * (1 - pass) + 1.1 * pass) * ridge;
      const dune = Math.exp(-Math.pow((Math.abs(z) - 20) / 18, 2)) * (1 - pass);
      h += 2.4 * Math.sin(x * 0.2) * Math.sin(z * 0.33) * dune;
      return h;
    },
    solids: [],
    roughZones: [],
    semanticAt(x, z, slope, T) {
      if (T < 0.08) return 'CLIFF';
      if (slope > 0.52) return 'SLOPE';
      if (Math.abs(z) > 18 && x < 40) return 'SAND';
      return 'FLAT';
    },
    events: []
  },

  ruins: {
    id: 'ruins',
    name: 'Ruinas / Piso difícil',
    fogNear: 70,
    fogFar: 360,
    fogColor: 0x0c0a08,
    sky: 0x0c0a08,
    dust: 0.35,
    uncertaintyBias: 0.12,
    heightFn(x, z) {
      let h = 0.8 * Math.sin(x * 0.04) * Math.cos(z * 0.035);
      h += 0.4 * Math.sin(x * 0.12 + z * 0.1);
      // broken slabs / steps
      if (x > -20 && x < 20 && z > -30 && z < 10) {
        const step = Math.floor((z + 30) / 8) * 1.8;
        h += step;
      }
      return h;
    },
    solids: [
      { minX: -48, maxX: -32, minZ: -70, maxZ: -18, h: 7 },
      { minX: 8, maxX: 22, minZ: -8, maxZ: 55, h: 7 },
      { minX: -12, maxX: -4, minZ: 12, maxZ: 28, h: 5 },
      { minX: 28, maxX: 40, minZ: -40, maxZ: -28, h: 6 }
    ],
    roughZones: [
      { minX: -25, maxX: 25, minZ: -35, maxZ: 15, T: 0.22 }
    ],
    semanticAt(x, z, slope, T) {
      if (T < 0.08) return 'CLIFF';
      if (T < 0.35) return 'RUBBLE';
      if (slope > 0.35) return 'SLOPE';
      return 'FLAT';
    },
    events: []
  },

  earthquake: {
    id: 'earthquake',
    name: 'Terremoto',
    fogNear: 60,
    fogFar: 320,
    fogColor: 0x120a08,
    sky: 0x120a08,
    dust: 0.55,
    uncertaintyBias: 0.2,
    heightFn(x, z) {
      let h = 1.2 * Math.sin(x * 0.03) * Math.cos(z * 0.028);
      h += 0.6 * Math.sin(x * 0.09 + z * 0.07);
      function mound(mx, mz, amp, rad) {
        const dx = x - mx, dz = z - mz;
        return amp * Math.exp(-(dx * dx + dz * dz) / (rad * rad));
      }
      h += mound(-30, 10, 5, 14);
      h += mound(20, -20, 4.5, 12);
      return h;
    },
    solids: [
      { minX: -20, maxX: -8, minZ: -50, maxZ: -35, h: 9, collapseAt: 18 },
      { minX: 15, maxX: 30, minZ: 5, maxZ: 22, h: 8, collapseAt: 28 },
      { minX: -5, maxX: 5, minZ: 30, maxZ: 42, h: 6, collapseAt: 40 }
    ],
    roughZones: [],
    semanticAt(x, z, slope, T) {
      if (T < 0.08) return 'CLIFF';
      if (T < 0.4) return 'RUBBLE';
      if (slope > 0.4) return 'SLOPE';
      return 'FLAT';
    },
    events: [
      { t: 8, type: 'shake', intensity: 0.6, duration: 4 },
      { t: 18, type: 'collapse', intensity: 1, duration: 2 },
      { t: 22, type: 'comms_drop', duration: 12 },
      { t: 28, type: 'collapse', intensity: 1.2, duration: 3 },
      { t: 40, type: 'shake', intensity: 0.4, duration: 3 }
    ]
  },

  swamp: {
    id: 'swamp',
    name: 'Pantano / Arena',
    fogNear: 50,
    fogFar: 280,
    fogColor: 0x0a120e,
    sky: 0x0a120e,
    dust: 0.25,
    uncertaintyBias: 0.1,
    heightFn(x, z) {
      let h = 0.35 * Math.sin(x * 0.05) * Math.cos(z * 0.045);
      h += 0.2 * Math.sin(x * 0.18 + z * 0.14);
      return h;
    },
    solids: [
      { minX: 40, maxX: 55, minZ: -20, maxZ: 10, h: 4 }
    ],
    roughZones: [
      { minX: -80, maxX: 80, minZ: -80, maxZ: 80, T: 0.22 }
    ],
    semanticAt(x, z, slope, T) {
      if (T < 0.15) return 'WATER';
      if (T < 0.4) return 'SAND';
      return 'FLAT';
    },
    events: []
  },

  night: {
    id: 'night',
    name: 'Noche / Polvo',
    fogNear: 40,
    fogFar: 220,
    fogColor: 0x030508,
    sky: 0x030508,
    dust: 0.7,
    uncertaintyBias: 0.35,
    heightFn(x, z) {
      let h = 1.5 * Math.sin(x * 0.025) * Math.cos(z * 0.022);
      h += 0.9 * Math.sin(x * 0.06 + 1.1) * Math.sin(z * 0.05);
      const pass = THREE.MathUtils.smoothstep(30, 55, x);
      const ridge = Math.exp(-((z / 10) * (z / 10)));
      h += 10 * (1 - pass) * ridge;
      return h;
    },
    solids: [
      { minX: -35, maxX: -22, minZ: -10, maxZ: 20, h: 6 }
    ],
    roughZones: [
      { minX: -60, maxX: 0, minZ: -40, maxZ: 40, T: 0.48 }
    ],
    semanticAt(x, z, slope, T) {
      if (T < 0.08) return 'CLIFF';
      if (slope > 0.45) return 'SLOPE';
      if (T < 0.5) return 'SAND';
      return 'FLAT';
    },
    events: [
      { t: 15, type: 'dust_storm', intensity: 0.8, duration: 20 }
    ]
  }
};

export function listScenarios() {
  return Object.values(SCENARIOS).map((s) => ({ id: s.id, name: s.name }));
}
