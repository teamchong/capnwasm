// Three-globe / globe.gl renderer for the /playground page.
//
// Wraps globe.gl with a Cloudflare-orange material, 2920 endpoint dots
// placed at the lat/lng the build script assigned, click + hover hooks,
// and a method to fire HTML bubbles at any (lat, lng) for the editor's
// output. Loaded dynamically from globe.ts so the inspector + editor
// are usable before three.js arrives over the wire.

// @ts-ignore — globe.gl ships its own .d.ts but tsc-as-vite can be picky
// at first build. Runtime resolution is fine.
import Globe from "globe.gl";
// @ts-ignore — Mesh + materials referenced for the custom globe surface.
import * as THREE from "three";

export interface GlobeEndpoint {
  id: string;
  path: string;
  method: string;
  tag: string;
  lat: number;
  lng: number;
  pop: string;
}

export interface GlobeHandle {
  /** Highlight a dot and float a bubble of `text` out of its position. */
  fireBubble(endpointId: string, text: string): void;
  /** Center the camera on a given endpoint. */
  focus(endpointId: string): void;
  /** Replace the dot dataset (used when the index loads). */
  setEndpoints(eps: GlobeEndpoint[]): void;
  /** Tear down the renderer (e.g. on hot reload). */
  destroy(): void;
}

interface MountOpts {
  container: HTMLElement;
  bubbleLayer: HTMLElement;
  initial: GlobeEndpoint[];
  onSelect: (ep: GlobeEndpoint) => void;
}

const ORANGE_PRIMARY = "#ff6900";    // Cloudflare orange
const ORANGE_DEEP    = "#3a1a04";    // shadow / emissive tint
const DOT_COLOR_DEFAULT = "rgba(255, 220, 130, 0.85)";
const DOT_COLOR_SELECTED = "#ffffff";

interface ActiveBubble {
  id: string;
  endpointId: string;
  lat: number;
  lng: number;
  el: HTMLDivElement;
  bornAt: number;
}

export function mountGlobeRenderer(opts: MountOpts): GlobeHandle {
  const { container, bubbleLayer, initial, onSelect } = opts;

  // Sphere material: solid Cloudflare-orange Phong with low emissive so
  // the dark side of the globe still shows the brand color faintly.
  const globeMaterial = new (THREE as any).MeshPhongMaterial({
    color: ORANGE_PRIMARY,
    emissive: ORANGE_DEEP,
    emissiveIntensity: 0.45,
    shininess: 12,
  });

  let endpoints = initial.slice();
  let selectedId: string | null = null;

  // @ts-ignore — globe.gl is callable as a factory.
  const globe = Globe()(container)
    .backgroundColor("rgba(0,0,0,0)")
    .globeMaterial(globeMaterial)
    .showAtmosphere(true)
    .atmosphereColor(ORANGE_PRIMARY)
    .atmosphereAltitude(0.18)
    .pointsData(endpoints)
    .pointLat((d: any) => d.lat)
    .pointLng((d: any) => d.lng)
    .pointAltitude(0.01)
    .pointRadius(0.18)
    .pointColor((d: any) => d.id === selectedId ? DOT_COLOR_SELECTED : DOT_COLOR_DEFAULT)
    .pointLabel((d: any) => `<b>${d.method}</b> <code>${d.path}</code><br><span style="opacity:0.6">${d.tag} · ${d.pop}</span>`)
    .onPointClick((d: any) => {
      selectedId = d.id;
      globe.pointColor((p: any) => p.id === selectedId ? DOT_COLOR_SELECTED : DOT_COLOR_DEFAULT);
      onSelect(d);
    });

  // Slow auto-rotate for ambient motion. Pauses on user interaction.
  const controls = (globe as any).controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  // Track size so the canvas fits its container even after resize.
  const resize = () => {
    globe.width(container.clientWidth);
    globe.height(container.clientHeight);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ---- Bubble animation -------------------------------------------------
  // Bubbles are HTML overlays positioned over the canvas. We compute the
  // screen position from (lat, lng) on every frame so the bubble sticks
  // to the dot as the globe rotates.
  const bubbles: ActiveBubble[] = [];
  let bubbleSeq = 0;

  function fireBubble(endpointId: string, text: string): void {
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return;
    selectedId = endpointId;
    globe.pointColor((p: any) => p.id === selectedId ? DOT_COLOR_SELECTED : DOT_COLOR_DEFAULT);

    const el = document.createElement("div");
    el.className = "globe-bubble";
    el.textContent = text || "(empty)";
    bubbleLayer.appendChild(el);
    bubbles.push({
      id:         `b${bubbleSeq++}`,
      endpointId: ep.id,
      lat:        ep.lat,
      lng:        ep.lng,
      el,
      bornAt:     performance.now(),
    });
    // Pulse the dot via a brief altitude bump so the user sees the
    // origin of the bubble.
    pulseDot(ep);
  }

  function pulseDot(ep: GlobeEndpoint): void {
    // Temporarily inflate the point altitude / radius for this dot.
    const augmented = endpoints.map((e) =>
      e.id === ep.id ? { ...e, _pulseEnd: performance.now() + 600 } : e,
    );
    globe.pointsData(augmented);
    globe.pointAltitude((d: any) =>
      d._pulseEnd && performance.now() < d._pulseEnd ? 0.05 : 0.01,
    );
    globe.pointRadius((d: any) =>
      d._pulseEnd && performance.now() < d._pulseEnd ? 0.36 : 0.18,
    );
    setTimeout(() => {
      globe.pointsData(endpoints);
      globe.pointAltitude(0.01).pointRadius(0.18);
    }, 700);
  }

  function focus(endpointId: string): void {
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return;
    selectedId = endpointId;
    globe.pointColor((p: any) => p.id === selectedId ? DOT_COLOR_SELECTED : DOT_COLOR_DEFAULT);
    globe.pointOfView({ lat: ep.lat, lng: ep.lng, altitude: 1.8 }, 1200);
  }

  function setEndpoints(eps: GlobeEndpoint[]): void {
    endpoints = eps;
    globe.pointsData(eps);
  }

  function destroy(): void {
    ro.disconnect();
    container.replaceChildren();
    bubbleLayer.replaceChildren();
  }

  // Per-frame bubble repositioning. Bubbles float upward over their
  // lifetime and fade out at ~3.5 s.
  function tick(now: number): void {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const age = now - b.bornAt;
      if (age > 3500) {
        b.el.remove();
        bubbles.splice(i, 1);
        continue;
      }
      const screen = (globe as any).getScreenCoords(b.lat, b.lng, 0.04);
      if (!screen) continue;
      const lift = Math.min(60, age / 30);
      const opacity = age < 200 ? age / 200 : age > 2800 ? Math.max(0, (3500 - age) / 700) : 1;
      b.el.style.transform = `translate(-50%, calc(-100% - ${lift}px)) translate(${screen.x}px, ${screen.y}px)`;
      b.el.style.opacity = String(opacity);
      b.el.style.left = "0";
      b.el.style.top  = "0";
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { fireBubble, focus, setEndpoints, destroy };
}
