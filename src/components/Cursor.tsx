import { useEffect, useRef } from "react";

export function Cursor() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const root = rootRef.current;
    if (!root) return;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let x = mouseX;
    let y = mouseY;
    let raf = 0;

    const onMove = (event: MouseEvent) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest(
        "a, button, input, textarea, select, .grid-item, .anchor",
      );
      root.classList.toggle("is-hover", Boolean(interactive));
    };

    const onLeave = () => root.classList.add("is-hidden");
    const onEnter = () => root.classList.remove("is-hidden");

    const loop = () => {
      x += (mouseX - x) * 0.22;
      y += (mouseY - y) * 0.22;
      root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseenter", onEnter);
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseenter", onEnter);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="cursor" ref={rootRef} aria-hidden="true">
      <span className="cursor__cross" />
      <span className="cursor__dot" />
    </div>
  );
}
