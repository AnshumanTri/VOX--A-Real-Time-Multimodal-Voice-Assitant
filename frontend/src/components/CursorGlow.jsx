import { useEffect, useRef, useState } from "react";

export default function CursorGlow({ suppressed }) {
  const glowRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });
  const started = useRef(false);
  const [hasMoved, setHasMoved] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return; // no cursor on touch

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lerpFactor = reducedMotion ? 1 : 0.16;

    const handleMove = (e) => {
      target.current.x = e.clientX;
      target.current.y = e.clientY;
      if (!started.current) {
        pos.current.x = e.clientX;
        pos.current.y = e.clientY;
        started.current = true;
        setHasMoved(true);
      }
    };
    window.addEventListener("pointermove", handleMove);

    let rafId;
    const animate = () => {
      pos.current.x += (target.current.x - pos.current.x) * lerpFactor;
      pos.current.y += (target.current.y - pos.current.y) * lerpFactor;
      if (glowRef.current) {
        glowRef.current.style.transform = `translate3d(${pos.current.x}px, ${pos.current.y}px, 0)`;
      }
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  const visible = hasMoved && !suppressed;

  return <div ref={glowRef} className={`cursor-glow ${visible ? "is-visible" : ""}`} />;
}