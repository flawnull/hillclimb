"use client";

import React, { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { CarDef } from "@/game/vehicle/cars";
import { EngineRenderState } from "@/game/Engine";

interface VehicleRendererProps {
  car: CarDef;
  colorIndex: number;
  renderStateRef: React.MutableRefObject<EngineRenderState>;
}

export const VehicleRenderer: React.FC<VehicleRendererProps> = ({
  car,
  colorIndex,
  renderStateRef,
}) => {
  const rootGroupRef = useRef<THREE.Group>(null);
  const chassisRef = useRef<THREE.Group>(null);
  const frontLeftWheelRef = useRef<THREE.Group>(null);
  const frontRightWheelRef = useRef<THREE.Group>(null);
  const rearLeftWheelRef = useRef<THREE.Group>(null);
  const rearRightWheelRef = useRef<THREE.Group>(null);
  const brakeLightMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const perkGlowRef = useRef<THREE.MeshBasicMaterial>(null);
  const smokeParticlesRef = useRef<THREE.Points>(null);

  const colorway = car.colorways[colorIndex] || car.colorways[0];

  // Smoke particle system
  const particleCount = 60;
  const { particlePositions, particleAges, particleVelocities } = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const ages = new Float32Array(particleCount);
    const vels = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      ages[i] = 1.0; // all dead initially
    }
    return { particlePositions: pos, particleAges: ages, particleVelocities: vels };
  }, []);

  const smokeGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    return geo;
  }, [particlePositions]);

  // Dimensions based on car class
  const dims = useMemo(() => {
    switch (colorway.bodyStyle) {
      case "rally_hatch":
        return { length: 3.9, width: 1.76, height: 1.38, wheelRadius: 0.32, wheelWidth: 0.22, hoodLen: 1.1, cabinLen: 1.9, roofH: 0.65 };
      case "box_utility":
        return { length: 3.5, width: 1.55, height: 1.58, wheelRadius: 0.31, wheelWidth: 0.20, hoodLen: 0.9, cabinLen: 2.1, roofH: 0.85 };
      case "sport_mid":
        return { length: 4.15, width: 1.82, height: 1.22, wheelRadius: 0.33, wheelWidth: 0.25, hoodLen: 1.4, cabinLen: 1.6, roofH: 0.48 };
      case "coupe":
      default:
        return { length: 4.38, width: 1.78, height: 1.32, wheelRadius: 0.33, wheelWidth: 0.23, hoodLen: 1.5, cabinLen: 1.7, roofH: 0.55 };
    }
  }, [colorway.bodyStyle]);

  let wheelAngle = 0;

  useFrame((_, delta) => {
    const s = renderStateRef.current;
    if (!rootGroupRef.current) return;

    // 1. Position and Heading
    rootGroupRef.current.position.set(s.pos.x, s.pos.y, s.pos.z);
    rootGroupRef.current.rotation.y = s.heading;

    // 2. Chassis Pitch and Roll
    if (chassisRef.current) {
      chassisRef.current.rotation.x = s.pitch;
      chassisRef.current.rotation.z = s.roll;
    }

    // 3. Wheel Steering and Rotation
    const steerAngle = s.steer * (car.maxSteerAngle || 0.55);
    if (frontLeftWheelRef.current) frontLeftWheelRef.current.rotation.y = steerAngle;
    if (frontRightWheelRef.current) frontRightWheelRef.current.rotation.y = steerAngle;

    wheelAngle += (s.speedMs / (dims.wheelRadius || 0.33)) * delta;
    if (frontLeftWheelRef.current) frontLeftWheelRef.current.rotation.x = wheelAngle;
    if (frontRightWheelRef.current) frontRightWheelRef.current.rotation.x = wheelAngle;
    if (rearLeftWheelRef.current) rearLeftWheelRef.current.rotation.x = wheelAngle;
    if (rearRightWheelRef.current) rearRightWheelRef.current.rotation.x = wheelAngle;

    // 4. Brake lights
    if (brakeLightMatRef.current) {
      const isBraking = s.brake > 0.1 || s.handbrake;
      brakeLightMatRef.current.color.set(isBraking ? "#ff1a1a" : "#660000");
    }

    // 5. Perk Glow
    if (perkGlowRef.current) {
      perkGlowRef.current.opacity = s.perkActive ? 0.8 : 0.0;
    }

    // 6. Tire Smoke Update
    if (smokeParticlesRef.current && smokeGeo) {
      const posAttr = smokeGeo.attributes.position as THREE.BufferAttribute;
      const positions = posAttr.array as Float32Array;

      // Spawn new particles if sliding
      if (s.isSliding && s.speedMs > 5.0) {
        for (let i = 0; i < 2; i++) {
          const idx = Math.floor(Math.random() * particleCount);
          particleAges[idx] = 0;
          // Spawn near rear tires in world space
          const spawnOffset = (Math.random() - 0.5) * dims.width;
          positions[idx * 3] = s.pos.x + Math.cos(s.heading) * spawnOffset;
          positions[idx * 3 + 1] = s.pos.y + 0.15;
          positions[idx * 3 + 2] = s.pos.z - Math.sin(s.heading) * spawnOffset;

          particleVelocities[idx * 3] = (Math.random() - 0.5) * 2;
          particleVelocities[idx * 3 + 1] = 0.8 + Math.random() * 1.2;
          particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 2;
        }
      }

      // Step particles
      for (let i = 0; i < particleCount; i++) {
        if (particleAges[i] < 1.0) {
          particleAges[i] += delta * 1.8;
          positions[i * 3] += particleVelocities[i * 3] * delta;
          positions[i * 3 + 1] += particleVelocities[i * 3 + 1] * delta;
          positions[i * 3 + 2] += particleVelocities[i * 3 + 2] * delta;
        } else {
          positions[i * 3 + 1] = -100; // hide below ground
        }
      }
      posAttr.needsUpdate = true;
    }
  });

  return (
    <>
      <group ref={rootGroupRef}>
        {/* Chassis group with roll/pitch */}
        <group ref={chassisRef} position={[0, dims.wheelRadius * 0.7, 0]}>
          {/* Main Lower Body */}
          <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
            <boxGeometry args={[dims.width, 0.45, dims.length]} />
            <meshStandardMaterial
              color={colorway.primary}
              roughness={0.25}
              metalness={0.5}
              flatShading
            />
          </mesh>

          {/* Cabin / Roof */}
          <mesh
            position={[0, 0.28 + 0.225 + dims.roofH / 2, -dims.length * 0.1]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[dims.width * 0.86, dims.roofH, dims.cabinLen]} />
            <meshStandardMaterial
              color={colorway.secondary}
              roughness={0.2}
              metalness={0.6}
              flatShading
            />
          </mesh>

          {/* Windshield & Windows */}
          <mesh
            position={[0, 0.28 + 0.225 + dims.roofH / 2, -dims.length * 0.1]}
          >
            <boxGeometry args={[dims.width * 0.88, dims.roofH * 0.82, dims.cabinLen * 0.95]} />
            <meshStandardMaterial
              color="#0f172a"
              roughness={0.1}
              metalness={0.9}
            />
          </mesh>

          {/* Front Grille / Air Intake (Stylized, abstract homage) */}
          <mesh position={[0, 0.25, dims.length / 2 + 0.01]}>
            <boxGeometry args={[dims.width * 0.65, 0.2, 0.05]} />
            <meshStandardMaterial color="#18181b" roughness={0.8} />
          </mesh>

          {/* Headlights */}
          <mesh position={[-dims.width * 0.35, 0.35, dims.length / 2 + 0.01]}>
            <boxGeometry args={[0.22, 0.12, 0.04]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[dims.width * 0.35, 0.35, dims.length / 2 + 0.01]}>
            <boxGeometry args={[0.22, 0.12, 0.04]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>

          {/* Taillights / Brake lights */}
          <mesh position={[-dims.width * 0.36, 0.36, -dims.length / 2 - 0.01]}>
            <boxGeometry args={[0.22, 0.10, 0.04]} />
            <meshBasicMaterial ref={brakeLightMatRef} color="#660000" />
          </mesh>
          <mesh position={[dims.width * 0.36, 0.36, -dims.length / 2 - 0.01]}>
            <boxGeometry args={[0.22, 0.10, 0.04]} />
            <meshBasicMaterial color="#660000" />
          </mesh>

          {/* Accent Livery Stripe */}
          <mesh position={[0, 0.52, 0]}>
            <boxGeometry args={[dims.width * 0.2, 0.02, dims.length * 0.98]} />
            <meshStandardMaterial color={colorway.accent} roughness={0.3} />
          </mesh>

          {/* Rear Spoiler / Wing if Sport or Rally */}
          {(colorway.bodyStyle === "sport_mid" || colorway.bodyStyle === "rally_hatch") && (
            <group position={[0, 0.6 + dims.roofH, -dims.length * 0.45]}>
              <mesh castShadow>
                <boxGeometry args={[dims.width * 0.9, 0.05, 0.3]} />
                <meshStandardMaterial color={colorway.secondary} roughness={0.3} />
              </mesh>
              <mesh position={[-dims.width * 0.35, -0.15, 0]}>
                <boxGeometry args={[0.04, 0.3, 0.15]} />
                <meshStandardMaterial color="#18181b" />
              </mesh>
              <mesh position={[dims.width * 0.35, -0.15, 0]}>
                <boxGeometry args={[0.04, 0.3, 0.15]} />
                <meshStandardMaterial color="#18181b" />
              </mesh>
            </group>
          )}

          {/* Underglow / Active Perk Aura */}
          <mesh position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[dims.width * 1.2, dims.length * 1.1]} />
            <meshBasicMaterial
              ref={perkGlowRef}
              color={colorway.accent}
              transparent
              opacity={0}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>

        {/* Wheels */}
        {/* Front Left */}
        <group position={[-dims.width / 2 - 0.05, dims.wheelRadius, car.wheelbase * 0.55]}>
          <group ref={frontLeftWheelRef}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[dims.wheelRadius, dims.wheelRadius, dims.wheelWidth, 14]} />
              <meshStandardMaterial color="#1c1917" roughness={0.9} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[-0.02, 0, 0]}>
              <cylinderGeometry args={[dims.wheelRadius * 0.6, dims.wheelRadius * 0.6, dims.wheelWidth + 0.01, 8]} />
              <meshStandardMaterial color="#d4d4d8" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        </group>

        {/* Front Right */}
        <group position={[dims.width / 2 + 0.05, dims.wheelRadius, car.wheelbase * 0.55]}>
          <group ref={frontRightWheelRef}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[dims.wheelRadius, dims.wheelRadius, dims.wheelWidth, 14]} />
              <meshStandardMaterial color="#1c1917" roughness={0.9} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[0.02, 0, 0]}>
              <cylinderGeometry args={[dims.wheelRadius * 0.6, dims.wheelRadius * 0.6, dims.wheelWidth + 0.01, 8]} />
              <meshStandardMaterial color="#d4d4d8" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        </group>

        {/* Rear Left */}
        <group position={[-dims.width / 2 - 0.05, dims.wheelRadius, -car.wheelbase * 0.45]}>
          <group ref={rearLeftWheelRef}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[dims.wheelRadius, dims.wheelRadius, dims.wheelWidth, 14]} />
              <meshStandardMaterial color="#1c1917" roughness={0.9} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[-0.02, 0, 0]}>
              <cylinderGeometry args={[dims.wheelRadius * 0.6, dims.wheelRadius * 0.6, dims.wheelWidth + 0.01, 8]} />
              <meshStandardMaterial color="#d4d4d8" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        </group>

        {/* Rear Right */}
        <group position={[dims.width / 2 + 0.05, dims.wheelRadius, -car.wheelbase * 0.45]}>
          <group ref={rearRightWheelRef}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[dims.wheelRadius, dims.wheelRadius, dims.wheelWidth, 14]} />
              <meshStandardMaterial color="#1c1917" roughness={0.9} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[0.02, 0, 0]}>
              <cylinderGeometry args={[dims.wheelRadius * 0.6, dims.wheelRadius * 0.6, dims.wheelWidth + 0.01, 8]} />
              <meshStandardMaterial color="#d4d4d8" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        </group>
      </group>

      {/* World-space tire smoke particles */}
      <points ref={smokeParticlesRef} geometry={smokeGeo}>
        <pointsMaterial
          size={0.65}
          color="#d1d5db"
          transparent
          opacity={0.4}
          depthWrite={false}
        />
      </points>
    </>
  );
};
