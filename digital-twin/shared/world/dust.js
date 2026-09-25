/**
 * Sistema de partículas de polvo / escombros (Fase 1 visual).
 */
import * as THREE from 'three';

export class DustSystem {
  constructor(scene) {
    this.scene = scene;
    this.count = 400;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);
    const velocities = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = Math.random() * 40;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      velocities[i * 3] = (Math.random() - 0.5) * 2;
      velocities[i * 3 + 1] = Math.random() * 1.5;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.velocities = velocities;
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xbba888,
        size: 0.55,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
      })
    );
    this.points.visible = true;
    scene.add(this.points);
  }

  update(dt, intensity, center) {
    const pos = this.points.geometry.attributes.position;
    const boost = 0.15 + intensity * 1.4;
    this.points.material.opacity = 0.12 + intensity * 0.45;
    for (let i = 0; i < this.count; i++) {
      let x = pos.getX(i) + this.velocities[i * 3] * dt * boost;
      let y = pos.getY(i) + this.velocities[i * 3 + 1] * dt * boost;
      let z = pos.getZ(i) + this.velocities[i * 3 + 2] * dt * boost;
      if (y > 55 || Math.hypot(x - center.x, z - center.z) > 120) {
        x = center.x + (Math.random() - 0.5) * 80;
        y = Math.random() * 8;
        z = center.z + (Math.random() - 0.5) * 80;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }
}
