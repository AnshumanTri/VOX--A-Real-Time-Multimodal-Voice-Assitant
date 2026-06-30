import { useEffect, useRef } from "react";
import * as THREE from "three";

const VERTEX_SHADER = `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uReducedMotion;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDisplacement;

  void main() {
    vNormal = normalize(normalMatrix * normal);

    float idleWave = (1.0 - uReducedMotion) * (
      sin(position.x * 2.5 + uTime * 0.6) * 0.04 +
      sin(position.y * 3.0 + uTime * 0.4) * 0.03 +
      sin(position.z * 2.0 + uTime * 0.5) * 0.03
    );
    float reactiveWave = uAmplitude * (sin(position.x * 6.0 + uTime * 4.0) * 0.5 + 0.5) * 0.18;
    float displacement = idleWave + reactiveWave;
    vDisplacement = displacement;

    vec3 displaced = position + normal * displacement;
    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 uAccent;
  uniform float uAmplitude;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDisplacement;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.2);
    vec3 core = uAccent * 0.35;
    vec3 rim = uAccent * 1.4;
    vec3 color = mix(core, rim, fresnel);
    float pulse = 0.55 + uAmplitude * 0.9 + vDisplacement * 1.2;
    gl_FragColor = vec4(color * pulse, 1.0);
  }
`;

const HALO_FRAGMENT_SHADER = `
  uniform vec3 uAccent;
  uniform float uAmplitude;
  varying vec3 vNormal;

  void main() {
    float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    gl_FragColor = vec4(uAccent, clamp(intensity, 0.0, 1.0) * (0.35 + uAmplitude * 0.65));
  }
`;

const HALO_VERTEX_SHADER = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ACCENT_RGB = new THREE.Color(0.3, 0.78, 0.98);

export default function Orb({ state, amplitude }) {
  const containerRef = useRef(null);
  const amplitudeRef = useRef(0);
  const stateRef = useRef(state);

  useEffect(() => {
    amplitudeRef.current = amplitude;
  }, [amplitude]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 3.4;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const uniforms = {
      uTime: { value: 0 },
      uAmplitude: { value: 0 },
      uReducedMotion: { value: reducedMotion },
      uAccent: { value: ACCENT_RGB },
    };

    const coreGeometry = new THREE.IcosahedronGeometry(1, 4);
    const coreMaterial = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(core);

    const haloGeometry = new THREE.IcosahedronGeometry(1.35, 3);
    const haloMaterial = new THREE.ShaderMaterial({
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
      uniforms,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    scene.add(halo);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let rafId;
    const clock = new THREE.Clock();
    const animate = () => {
      const t = clock.getElapsedTime();
      uniforms.uTime.value = t;
      uniforms.uAmplitude.value = amplitudeRef.current;

      const spin = reducedMotion ? 0 : 0.15;
      core.rotation.y = t * spin;
      halo.rotation.y = t * spin;

      if (stateRef.current === "thinking" && !reducedMotion) {
        uniforms.uAmplitude.value = 0.25 + Math.sin(t * 3) * 0.15;
      } else if (stateRef.current === "speaking" && !reducedMotion) {
        uniforms.uAmplitude.value = 0.3 + Math.abs(Math.sin(t * 6)) * 0.35;
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      coreGeometry.dispose();
      coreMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className="orb-canvas" />;
}