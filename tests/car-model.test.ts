/**
 * VAL BORBERA HILLCLIMB — Car Model Integrity Suite
 *
 * The car is the one object on screen in every single frame, at the largest apparent size,
 * and it is generated rather than authored — so nothing catches a modelling defect except a
 * player looking at it. These are the properties that were actually wrong.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { CarMeshBuilder } from "../src/game/renderer/CarMeshBuilder";
import { CAR_DEFS } from "../src/game/vehicle/cars";

const ALL_VARIANTS: { id: string; colorIndex: number }[] = [];
for (const car of Object.values(CAR_DEFS)) {
  for (let i = 0; i < car.colorways.length; i++) ALL_VARIANTS.push({ id: car.id, colorIndex: i });
}

interface Tri {
  verts: THREE.Vector3[];
  normal: THREE.Vector3;
}

function triangles(mesh: THREE.Mesh): Tri[] {
  const pos = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const count = index ? index.count / 3 : pos.count / 3;
  const out: Tri[] = [];
  for (let t = 0; t < count; t++) {
    const verts = [0, 1, 2].map((k) => {
      const a = index ? index.getX(t * 3 + k) : t * 3 + k;
      return new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a));
    });
    const normal = verts[1]
      .clone()
      .sub(verts[0])
      .cross(verts[2].clone().sub(verts[0]))
      .normalize();
    out.push({ verts, normal });
  }
  return out;
}

/** Sorted, rounded vertex triple — identifies a triangle regardless of which corner it
 *  happens to start from. */
function key(verts: THREE.Vector3[], mirror: boolean): string {
  return verts
    .map((v) => `${((mirror ? -v.x : v.x) + 0).toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`)
    .sort()
    .join("|");
}

describe("Car model", () => {
  it("builds every car and colourway with no DOM", () => {
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);
      assert.ok(result.chassisMesh.geometry.attributes.position.count > 0, `${v.id}/${v.colorIndex}`);
    }
  });

  it("bodywork and glass are mirror-symmetric about the centreline", () => {
    // The shell used to be lofted as a closed ring of six profile points, one quad per edge,
    // each split as (0,1,2)+(0,2,3). Walking the ring in order delivers the left flank's
    // corners as sill,sill,belt,belt and the right flank's as belt,belt,sill,sill — the same
    // band entered from the other end — so the two sides were split along OPPOSITE diagonals.
    // The panels are saddle-shaped (both width and height change between sections), so those
    // two splits are different surfaces: the crease fell one way on the left and the other on
    // the right, worst where the profile changes fastest, which is the C-pillar and backlight.
    //
    // On the old geometry this assertion reported all 64 body triangles and all 16 glass
    // triangles failing, on all four cars. The shell is now emitted as one half plus an
    // explicit reflection, so symmetry cannot depend on the section table's luck.
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);

      for (const [label, mesh] of [
        ["body", result.chassisMesh],
        ["glass", result.glassMesh],
      ] as const) {
        const tris = triangles(mesh);
        const byKey = new Map<string, Tri[]>();
        for (const tri of tris) {
          const k = key(tri.verts, false);
          if (!byKey.has(k)) byKey.set(k, []);
          byKey.get(k)!.push(tri);
        }

        let unmatched = 0;
        for (const tri of tris) {
          const candidates = byKey.get(key(tri.verts, true));
          // A mirrored triangle must exist AND face the mirrored direction, or the two sides
          // would shade differently even with identical outlines.
          const ok = candidates?.some(
            (other) =>
              Math.abs(other.normal.x + tri.normal.x) < 1e-3 &&
              Math.abs(other.normal.y - tri.normal.y) < 1e-3 &&
              Math.abs(other.normal.z - tri.normal.z) < 1e-3
          );
          if (!ok) unmatched++;
        }

        assert.equal(
          unmatched,
          0,
          `${v.id}/${v.colorIndex} ${label}: ${unmatched} of ${tris.length} triangles have no ` +
            `correctly-wound mirror. The shell must be emitted as one half and reflected — ` +
            `walking a closed profile ring splits the two flanks along opposite diagonals.`
        );
      }
    }
  });

  it("every shell triangle faces outward", () => {
    // Under `side: FrontSide` an inside-out triangle is simply absent, leaving a hole in the
    // bodywork that the interior shows through.
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);
      for (const [label, mesh] of [
        ["body", result.chassisMesh],
        ["glass", result.glassMesh],
      ] as const) {
        const tris = triangles(mesh);
        const centroid = new THREE.Vector3();
        let n = 0;
        for (const tri of tris) for (const p of tri.verts) { centroid.add(p); n++; }
        centroid.divideScalar(n);

        let inward = 0;
        for (const tri of tris) {
          const mid = tri.verts[0].clone().add(tri.verts[1]).add(tri.verts[2]).divideScalar(3);
          if (tri.normal.dot(mid.sub(centroid)) < -1e-6) inward++;
        }
        assert.equal(inward, 0, `${v.id}/${v.colorIndex} ${label}: ${inward} inward-facing triangles`);
      }
    }
  });

  it("the contact shadow sits on the ground, not at axle height", () => {
    // The chassis is raised by `wheelRadius * 0.75` so the body sits on its suspension. The
    // ground decals were parented to it and inherited that lift, which put the contact patch
    // ~25 cm up, level with the axles and inside the bodywork — so the car read as floating,
    // which is exactly the symptom a contact shadow exists to prevent. y = 0 in the car group
    // is the tyre contact plane (wheels are pivoted at y = wheelRadius with that radius).
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);
      const decals: { name: string; y: number }[] = [];
      result.carGroup.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.geometry.type !== "PlaneGeometry") return;
        if (Math.abs(mesh.rotation.x + Math.PI / 2) > 1e-6) return; // ground-facing only
        decals.push({ name: mesh.uuid, y: mesh.getWorldPosition(new THREE.Vector3()).y });
      });

      assert.ok(decals.length >= 2, `${v.id}/${v.colorIndex}: expected a contact shadow and a perk aura`);
      for (const d of decals) {
        assert.ok(
          d.y < 0.06,
          `${v.id}/${v.colorIndex}: a ground decal sits ${d.y.toFixed(3)} m above the contact ` +
            `plane. Parent it to carGroup, not chassisGroup.`
        );
      }
    }
  });

  it("nothing on the tail panel hangs outside the bodywork", () => {
    // Four body styles share one builder and their tails are not alike. The lamp cluster was
    // authored as constants — a 1.50 x 0.15 housing at y = 0.44 — which overhung the coupe's
    // tail by 3.6 cm and the van's by 4.1 cm, and on the mid-engined car, whose tail panel
    // stops at y = 0.46, put the top third of the housing at a height where the bodywork has
    // no material at all. Straight on it hid behind the car; under roll it swung clear of the
    // silhouette and read as a bite taken out of the rear quarter.
    //
    // Measured against the real shell rather than against the numbers that produced it: cast
    // a ray outward along x from the centreline at the part's own height and depth, and take
    // the furthest hit as the half-width of the body there. No hit means no bodywork at all.
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);

      result.carGroup.updateMatrixWorld(true);

      // The shell geometry is authored in chassis-local space and the chassis is lifted onto
      // its suspension, so put both into world space before comparing them.
      const shell = new THREE.Group();
      const opaque = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      for (const src of [result.chassisMesh, result.glassMesh]) {
        const m = new THREE.Mesh(src.geometry, opaque);
        m.applyMatrix4(src.matrixWorld);
        shell.add(m);
      }
      shell.updateMatrixWorld(true);

      const shellBox = new THREE.Box3().setFromObject(shell);
      // Just INSIDE the closing cap. The lamps deliberately stand proud of the tail, so
      // sampling at their own depth asks about a place the bodywork does not reach and every
      // part looks like an overhang. The question is whether they fit the panel they sit on.
      const z = shellBox.min.z + 0.01;

      const ray = new THREE.Raycaster();
      const offenders: string[] = [];

      for (const part of result.tailPanelMeshes) {
        part.geometry.computeBoundingBox();
        const box = part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld);
        for (const y of [box.min.y, (box.min.y + box.max.y) / 2, box.max.y]) {
          for (const dir of [-1, 1]) {
            const reach = dir < 0 ? Math.abs(box.min.x) : box.max.x;
            ray.set(new THREE.Vector3(0, y, z), new THREE.Vector3(dir, 0, 0));
            const hits = ray.intersectObject(shell, true);
            const bodyHalfWidth = hits.length ? hits[hits.length - 1].distance : 0;
            if (reach > bodyHalfWidth + 1e-3) {
              offenders.push(
                `reaches ${reach.toFixed(3)} m at y=${y.toFixed(3)} where the body is ` +
                  `${bodyHalfWidth.toFixed(3)} m`
              );
            }
          }
        }
      }

      assert.deepEqual(
        offenders,
        [],
        `${v.id}/${v.colorIndex}: ${offenders.length} tail-panel overhang(s) — ` +
          offenders.join("; ") +
          `. Size the cluster from the rear section's profile, not from constants.`
      );
    }
  });

  it("tail panel features do not intersect one another", () => {
    // The twin exhaust tips ran straight through the bottom of the number plate on the blue
    // car: the tail is only 0.34 m deep, so a fixed-size lamp housing and plate crowded the
    // plate down onto pipes that sat under its centre. Overhang is not the only way parts go
    // wrong on a flat panel — they can also simply occupy the same space.
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);
      result.carGroup.updateMatrixWorld(true);

      const shellBox = new THREE.Box3().setFromObject(result.chassisMesh);

      // Everything mounted at the tail: the panel features plus the tailpipes, which are the
      // meshes that sit behind the closing cap.
      const parts: { name: string; box: THREE.Box3 }[] = [];
      for (const part of result.tailPanelMeshes) {
        part.geometry.computeBoundingBox();
        parts.push({
          name: part.geometry.type,
          box: part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld),
        });
      }
      // ONE BOX PER PIPE. Unioning them spans the whole rear, so a plate sitting neatly
      // between two widely-set tips looks like a clash when neither pipe touches it.
      let pipeCount = 0;
      result.carGroup.traverse((node) => {
        const mesh = node as THREE.Mesh;
        // The bore liner identifies a tailpipe: an open cylinder rendered from the inside.
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (!mesh.isMesh || !mat || mat.side !== THREE.BackSide) return;
        mesh.geometry.computeBoundingBox();
        parts.push({
          name: "exhaust",
          box: mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld),
        });
        pipeCount++;
      });
      assert.ok(pipeCount > 0, `${v.id}/${v.colorIndex}: found no tailpipe`);

      // The lenses are deliberately set INSIDE the housing's cut openings, so compare only
      // features that are meant to be separate: plate, plate recess, and the pipes.
      const separate = parts.filter((p) => p.name === "BoxGeometry" || p.name === "PlaneGeometry" || p.name === "exhaust");
      const clashes: string[] = [];
      for (let i = 0; i < separate.length; i++) {
        for (let j = i + 1; j < separate.length; j++) {
          const a = separate[i];
          const b = separate[j];
          // Plate sits inside its own recess by design; skip that one nesting.
          if (a.name !== "exhaust" && b.name !== "exhaust") continue;
          if (a.name === "exhaust" && b.name === "exhaust") continue;
          if (!a.box.intersectsBox(b.box)) continue;
          const overlap = a.box.clone().intersect(b.box);
          const size = overlap.getSize(new THREE.Vector3());
          if (size.x > 1e-3 && size.y > 1e-3 && size.z > 1e-3) {
            clashes.push(`${a.name} intersects ${b.name} by ${size.x.toFixed(3)} x ${size.y.toFixed(3)} m`);
          }
        }
      }
      void shellBox;
      assert.deepEqual(clashes, [], `${v.id}/${v.colorIndex}: ${clashes.join("; ")}`);
    }
  });

  it("no car material requests a transmission pass", () => {
    // `transmission > 0` makes three render the whole opaque scene into a second render
    // target every frame so refracting surfaces have something to sample. The glass was
    // paying for that to look through a window at a cabin this model does not have.
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);
      result.carGroup.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const transmission = (m as THREE.MeshPhysicalMaterial).transmission ?? 0;
          assert.equal(transmission, 0, `${v.id}/${v.colorIndex}: material requests transmission`);
        }
      });
    }
  });

  it("stays within its triangle budget", () => {
    // Mirroring doubles the emitted quads and the chamfers add two strips per section pair,
    // so the shell grew. Measured after both: the largest variant is well under this. The
    // scenery budget in scene-budget.test.ts is ~169k triangles a frame — the car must stay
    // a rounding error against that, not creep towards it.
    for (const v of ALL_VARIANTS) {
      const result = CarMeshBuilder.buildCarModel(CAR_DEFS[v.id], v.colorIndex);
      let tris = 0;
      result.carGroup.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
        const g = mesh.geometry;
        tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      });
      assert.ok(tris < 4000, `${v.id}/${v.colorIndex}: car model is ${tris} triangles`);
    }
  });
});
