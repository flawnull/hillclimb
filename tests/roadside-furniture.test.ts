/**
 * VAL BORBERA HILLCLIMB — Roadside Furniture Placement Suite
 *
 * The existing clearance suite asks whether props are OFF the road. These ask whether they
 * are on the correct SIDE of it, which is a different question and the one two live bugs
 * were hiding behind.
 *
 * 1. INVISIBLE WALLS. Engine.ts treats `sample.guardrail` as protecting whichever side the
 *    car leaves: the off-road fall fires on `isExposed && !guardrail`, so a guarded sample
 *    gets solid wall collision on EITHER side. The builder drew a rail on one side only
 *    (`s.exposure === "left" ? -1 : 1`). On the 110 samples of Borbera Sprint marked
 *    `exposure: 'both'` with a rail, the left-hand rail was never drawn while the physics
 *    still stopped the car dead there. Nothing caught it because nothing compared the
 *    geometry against the rule the simulation applies.
 *
 * 2. KERBS ON THE OUTSIDE OF THE CORNER. Apex kerbs and chevron boards took their side from
 *    `s.bank > 0 ? 1 : -1`. 32 curving samples on Borbera Sprint and 49 on Salita di Cosola
 *    carry `bank === 0`, so the ternary fell through to -1 and put the kerb on the outside
 *    of every right-hander it touched; another 9 and 27 carry a bank whose sign disagrees
 *    with the direction the road actually turns.
 *
 * Both are checked against the GEOMETRY the game derives its own behaviour from — the sign
 * of the heading change, and Engine's own exposure/guardrail rule — rather than against a
 * restatement of the code under test.
 *
 * Furniture is built into fresh groups here rather than read off a RoadMesh, because
 * RoadMesh merges these groups with batchStaticGroup and individual props stop being
 * separable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import { getStageDef, STAGE_LIST } from "../src/game/track/stages";
import { TrackSpline, SplineSample } from "../src/game/track/TrackSpline";
import { buildRoadsideFurniture } from "../src/game/track/RoadsideFurnitureBuilder";

function normalizeAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

interface Built {
  spline: TrackSpline;
  samples: SplineSample[];
  landmarks: THREE.Group;
  guardrails: THREE.Group;
}

const BUILDS = new Map<string, Built>();
for (const entry of STAGE_LIST) {
  const spline = new TrackSpline(getStageDef(entry.id));
  const landmarks = new THREE.Group();
  const guardrails = new THREE.Group();
  buildRoadsideFurniture(spline.getAllSamples(), landmarks, guardrails);
  BUILDS.set(entry.id, { spline, samples: spline.getAllSamples(), landmarks, guardrails });
}

/**
 * Nearest road sample to a prop, ignoring carriageways more than 2.5 m above or below it.
 *
 * `TrackSpline.projectFrenet` is height-blind by design — the car only ever occupies one
 * tier, so the simulation never needs the distinction — but a prop does not. On a switchback
 * a guardrail post standing correctly beside its own leg is nearer IN PLAN to the leg three
 * metres below, and projectFrenet duly reports it as 0.28 m inside that leg's lane. It is
 * not: it is above it. Judging placement with the height-blind projection would fail correct
 * geometry and, if "fixed", would strip the furniture off every switchback.
 */
function projectNear(samples: SplineSample[], x: number, y: number, z: number) {
  let best = samples[0];
  let bestDistSq = Infinity;
  for (const other of samples) {
    if (Math.abs(other.y - y) > 2.5) continue;
    const dx = x - other.x;
    const dz = z - other.z;
    const d = dx * dx + dz * dz;
    if (d < bestDistSq) {
      bestDistSq = d;
      best = other;
    }
  }
  if (bestDistSq === Infinity) return null;
  const t = (x - best.x) * best.normalX + (z - best.z) * best.normalZ;
  return { sample: best, t };
}

/** Collects every mesh with the given name, in world space. */
function collect(root: THREE.Object3D, name: string): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (node.name !== name) return;
    out.push(new THREE.Vector3().setFromMatrixPosition(node.matrixWorld));
  });
  return out;
}

describe("Guardrails are drawn wherever the physics puts a wall", () => {
  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: a sample exposed on both sides gets a rail on both sides`, () => {
      const { samples, guardrails } = BUILDS.get(stageId)!;
      const posts = collect(guardrails, "guardrail-post");

      const bothSided = samples.filter((s) => s.guardrail && s.exposure === "both");
      if (bothSided.length === 0) return; // nothing to prove on this stage

      let unguarded = 0;
      let firstMiss = "";
      for (const s of bothSided) {
        for (const side of [-1, 1] as const) {
          const hw = s.halfWidth + 0.70;
          const ex = s.x + s.normalX * hw * side;
          const ez = s.z + s.normalZ * hw * side;
          // Posts are emitted every other sample, so allow a few metres of slack along the
          // road; what matters is that SOME rail exists on this side here.
          const near = posts.some((p) => Math.hypot(p.x - ex, p.z - ez) < 4.0);
          if (!near) {
            unguarded++;
            if (!firstMiss) firstMiss = `s=${s.s.toFixed(1)} side=${side > 0 ? "right" : "left"}`;
          }
        }
      }

      assert.strictEqual(
        unguarded,
        0,
        `${stageId}: ${unguarded} of ${bothSided.length * 2} guarded (sample, side) pairs have no rail ` +
          `(first: ${firstMiss}). Engine.ts applies solid wall collision on both sides of a ` +
          `guarded, both-exposed sample, so a missing rail is an invisible wall.`
      );
    });

    it(`${stageId}: every rail post sits outside the carriageway`, () => {
      const { samples, guardrails } = BUILDS.get(stageId)!;
      const posts = collect(guardrails, "guardrail-post");
      assert.ok(posts.length > 0, `${stageId}: no guardrail posts were generated at all`);
      for (const p of posts) {
        const proj = projectNear(samples, p.x, p.y, p.z);
        if (!proj) continue;
        assert.ok(
          Math.abs(proj.t) >= proj.sample.halfWidth - 0.05,
          `${stageId}: a rail post stands at |t| = ${Math.abs(proj.t).toFixed(2)} m against a ` +
            `half-width of ${proj.sample.halfWidth.toFixed(2)} m — inside the lane`
        );
      }
    });
  }
});

describe("Nothing spans the carriageway", () => {
  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: no guardrail beam crosses the road`, () => {
      const { samples, guardrails } = BUILDS.get(stageId)!;

      // A beam is a long thin box rotated to lie along the rail. Its two ends are what
      // matter: if they fall on opposite sides of the centreline, the beam is a steel bar
      // across the road at windscreen height. That is what a run of rail did when the
      // stage's `exposure` flipped from one side to the other between two guarded samples.
      let crossing = 0;
      let first = "";
      guardrails.updateMatrixWorld(true);
      guardrails.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const params = (mesh.geometry as THREE.BoxGeometry).parameters;
        if (!params || params.depth < 1.5) return; // posts and reflectors are not beams

        const half = params.depth / 2;
        const ends = [new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half)].map((v) =>
          v.applyMatrix4(mesh.matrixWorld)
        );
        const t = ends.map((e) => projectNear(samples, e.x, e.y, e.z)?.t);
        if (t[0] === undefined || t[1] === undefined) return;
        if (Math.sign(t[0]) !== Math.sign(t[1])) {
          crossing++;
          if (!first) first = `ends at t = ${t[0].toFixed(1)} and ${t[1].toFixed(1)} m`;
        }
      });

      assert.strictEqual(
        crossing,
        0,
        `${stageId}: ${crossing} guardrail beams span the carriageway (first: ${first})`
      );
    });
  }
});

describe("Corner furniture is on the correct side of the corner", () => {
  /**
   * Which way the road turns at arc length `s`, measured the way the height field and the
   * furniture builder both define it: the centre of curvature lies on the +normal side
   * exactly when the heading is increasing, since the tangent's derivative is
   * `normal * dh/ds` for `normal = (cos h, -sin h)`.
   */
  function turnAt(samples: SplineSample[], sValue: number): number {
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const d = Math.abs(samples[i].s - sValue);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    const prev = samples[Math.max(0, idx - 2)];
    const next = samples[Math.min(samples.length - 1, idx + 2)];
    return normalizeAngle(next.heading - prev.heading);
  }

  for (const entry of STAGE_LIST) {
    const stageId = entry.id;

    it(`${stageId}: apex kerbs are on the inside of the bend`, () => {
      const { samples, landmarks } = BUILDS.get(stageId)!;
      const kerbs = collect(landmarks, "apex-kerb");
      assert.ok(kerbs.length > 20, `${stageId}: only ${kerbs.length} kerbs generated`);

      let wrongSide = 0;
      let judged = 0;
      let firstWrong = "";
      for (const k of kerbs) {
        const proj = projectNear(samples, k.x, k.y, k.z);
        if (!proj) continue;
        const turn = turnAt(samples, proj.sample.s);
        // Judged only where the bend is unambiguous. The builder decides at the station it
        // places from; this reads the turn at whatever station the kerb's own position
        // projects to, up to a couple of metres away. Right at the 0.04 rad threshold where
        // curvature is changing sign those two stations genuinely disagree about which way
        // the road bends — one kerb on Salita di Cosola sits at turn = 0.047 — and neither
        // answer is wrong. Double the threshold and the question has an answer.
        if (Math.abs(turn) < 0.08) continue;
        judged++;
        const expected = turn > 0 ? 1 : -1;
        if (Math.sign(proj.t) !== expected) {
          wrongSide++;
          if (!firstWrong) firstWrong = `s=${proj.sample.s.toFixed(1)} t=${proj.t.toFixed(2)} turn=${turn.toFixed(3)}`;
        }
      }

      // Guards against the test quietly becoming vacuous if the gate above ever excludes
      // everything.
      // Guards against the test quietly becoming vacuous if the gate above ever excludes
      // everything. Borbera Sprint is mostly long sweepers, so only about a third of its
      // kerbs clear the unambiguous-bend gate; a floor of 50 keeps the check substantive
      // without demanding a corner profile the stages do not have.
      assert.ok(
        judged > 50 && judged > kerbs.length * 0.25,
        `${stageId}: only ${judged} of ${kerbs.length} kerbs were judged`
      );
      assert.strictEqual(
        wrongSide,
        0,
        `${stageId}: ${wrongSide} of ${judged} judged apex kerbs are on the OUTSIDE of the bend ` +
          `(first: ${firstWrong})`
      );
    });

    it(`${stageId}: chevron boards face the driver from the outside of the bend`, () => {
      const { samples, landmarks } = BUILDS.get(stageId)!;
      const chevrons = collect(landmarks, "chevron");
      if (chevrons.length === 0) return;

      let wrongSide = 0;
      for (const c of chevrons) {
        const proj = projectNear(samples, c.x, c.y, c.z);
        if (!proj) continue;
        const turn = turnAt(samples, proj.sample.s);
        if (Math.abs(turn) < 0.08) continue;
        const outside = turn > 0 ? -1 : 1;
        if (Math.sign(proj.t) !== outside) wrongSide++;
      }

      assert.strictEqual(
        wrongSide,
        0,
        `${stageId}: ${wrongSide} of ${chevrons.length} chevron boards stand on the inside of the ` +
          `bend, where the driver cannot see them and the apex kerb belongs`
      );
    });
  }
});
