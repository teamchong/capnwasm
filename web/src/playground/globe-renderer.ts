// SVG-only globe renderer for /playground.
//
// No three.js, no globe.gl, no WebGL, no Canvas. Pure SVG with a
// JS-driven orthographic projection updated on each animation frame.
// Same public API the previous renderer exposed so globe.ts doesn't
// have to change.

const SVG_NS = "http://www.w3.org/2000/svg";

const ORANGE_PRIMARY  = "#ff6900";
const ORANGE_DEEP     = "#3a1a04";
const COUNTRY_OUTLINE = "rgba(255, 255, 255, 0.55)";
const DOT_FILL        = "#fff5b8";
const DOT_FILL_HOT    = "#ffffff";
const ROTATE_DEG_PER_SEC = 5;
const FIRE_HOLD_MS = 4000;

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
  fireBubble(endpointId: string, text: string, langClass?: string): void;
  showBubble(endpointId: string, text: string, langClass?: string): void;
  clearBubble(): void;
  focus(endpointId: string): void;
  resume(): void;
  setEndpoints(eps: GlobeEndpoint[]): void;
  destroy(): void;
}

interface MountOpts {
  container: HTMLElement;
  bubbleLayer: HTMLElement;
  initial: GlobeEndpoint[];
  onSelect?: (ep: GlobeEndpoint) => void;
  onHover?: (ep: GlobeEndpoint) => void;
  onLeave?: () => void;
  onBubbleClick?: (ep: GlobeEndpoint) => void;
}

interface ActiveBubble {
  id: string;
  endpointId: string;
  el: HTMLDivElement;
  bornAt: number;
}

export function mountGlobeRenderer(opts: MountOpts): GlobeHandle {
  const { container, bubbleLayer, initial, onSelect, onHover, onLeave, onBubbleClick } = opts;

  // 1000-unit viewBox — math stays simple, scales to any container.
  const VB = 1000;
  const R  = 460;
  const cx = VB / 2;
  const cy = VB / 2;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${VB} ${VB}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.classList.add("globe-svg");

  const defs = document.createElementNS(SVG_NS, "defs");
  defs.innerHTML = `
    <radialGradient id="globe-atmo" cx="50%" cy="50%" r="55%">
      <stop offset="80%"  stop-color="${ORANGE_PRIMARY}" stop-opacity="0"/>
      <stop offset="92%"  stop-color="${ORANGE_PRIMARY}" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="${ORANGE_PRIMARY}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="globe-surface" cx="35%" cy="35%" r="75%">
      <stop offset="0%"   stop-color="#ffae5c"/>
      <stop offset="60%"  stop-color="${ORANGE_PRIMARY}"/>
      <stop offset="100%" stop-color="${ORANGE_DEEP}"/>
    </radialGradient>
  `;
  svg.appendChild(defs);

  const atmo = document.createElementNS(SVG_NS, "circle");
  atmo.setAttribute("cx", String(cx));
  atmo.setAttribute("cy", String(cy));
  atmo.setAttribute("r",  String(R + 35));
  atmo.setAttribute("fill", "url(#globe-atmo)");
  svg.appendChild(atmo);

  const sphere = document.createElementNS(SVG_NS, "circle");
  sphere.setAttribute("cx", String(cx));
  sphere.setAttribute("cy", String(cy));
  sphere.setAttribute("r",  String(R));
  sphere.setAttribute("fill", "url(#globe-surface)");
  svg.appendChild(sphere);

  // Country borders. One <path> updated per frame.
  const lands = document.createElementNS(SVG_NS, "path");
  lands.setAttribute("fill", "none");
  lands.setAttribute("stroke", COUNTRY_OUTLINE);
  lands.setAttribute("stroke-width", "0.8");
  lands.setAttribute("stroke-linejoin", "round");
  svg.appendChild(lands);

  const dotsGroup = document.createElementNS(SVG_NS, "g");
  dotsGroup.classList.add("globe-dots");
  svg.appendChild(dotsGroup);

  container.appendChild(svg);

  let endpoints = initial.slice();
  let dotEls: SVGCircleElement[] = [];
  rebuildDots();

  function rebuildDots(): void {
    dotsGroup.replaceChildren();
    dotEls = endpoints.map((ep) => {
      const c = document.createElementNS(SVG_NS, "circle");
      c.setAttribute("r", "5");
      c.setAttribute("fill", DOT_FILL);
      c.setAttribute("data-id", ep.id);
      c.setAttribute("tabindex", "0");
      c.style.cursor = "pointer";
      c.addEventListener("mouseenter", () => { if (onHover) onHover(ep); });
      c.addEventListener("focus", () => { if (onHover) onHover(ep); });
      c.addEventListener("mouseleave", () => { if (onLeave) onLeave(); });
      c.addEventListener("blur", () => { if (onLeave) onLeave(); });
      c.addEventListener("click", () => { if (onSelect) onSelect(ep); });
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${ep.method} ${ep.path}\n${ep.tag} · ${ep.pop}`;
      c.appendChild(title);
      dotsGroup.appendChild(c);
      return c;
    });
  }

  // Lazy-fetch country borders so first paint isn't blocked.
  let geoFeatures: any[] | null = null;
  fetch("/data/countries.geojson")
    .then((r) => (r.ok ? r.json() : null))
    .then((g) => {
      if (!g || !Array.isArray(g.features)) return;
      geoFeatures = g.features.filter(
        (f: any) =>
          f?.properties?.ISO_A2 !== "AQ" && f?.properties?.ADM0_A3 !== "ATA",
      );
    })
    .catch(() => { /* decoration only; never fatal */ });

  let lngOffset = 0;
  let lastFrame = performance.now();
  let paused = false;
  let stopped = false;
  const pulses = new Map<string, number>();

  const bubbles: ActiveBubble[] = [];
  let bubbleSeq = 0;
  let hoverBubble: ActiveBubble | null = null;
  let hoverEndpointId: string | null = null;

  function tick(now: number): void {
    if (stopped) return;
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!paused) lngOffset = (lngOffset + ROTATE_DEG_PER_SEC * dt) % 360;
    redraw(now);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame((t) => { lastFrame = t; requestAnimationFrame(tick); });

  function redraw(now: number): void {
    if (geoFeatures) lands.setAttribute("d", projectFeatures(geoFeatures, lngOffset, R, cx, cy));
    for (let i = 0; i < endpoints.length; i++) {
      const ep = endpoints[i];
      const p = project(ep.lat, ep.lng, lngOffset, R, cx, cy);
      const c = dotEls[i];
      if (!c) continue;
      if (!p.visible) {
        c.style.display = "none";
        continue;
      }
      c.style.display = "";
      c.setAttribute("cx", p.x.toFixed(2));
      c.setAttribute("cy", p.y.toFixed(2));
      const pulseEnd = pulses.get(ep.id);
      if (hoverEndpointId === ep.id) {
        const breathe = 1 + Math.sin(now / 140) * 0.28;
        c.setAttribute("r", String(8 * breathe));
        c.setAttribute("fill", DOT_FILL_HOT);
      } else if (pulseEnd && now < pulseEnd) {
        const t = Math.max(0, (pulseEnd - now) / 600);
        c.setAttribute("r", String(5 + 8 * t));
        c.setAttribute("fill", DOT_FILL_HOT);
      } else {
        c.setAttribute("r", "5");
        c.setAttribute("fill", DOT_FILL);
        if (pulseEnd) pulses.delete(ep.id);
      }
    }
    // Position bubbles using SVG → DOM coordinate mapping.
    if (bubbles.length === 0 && !hoverBubble) return;
    const svgRect = svg.getBoundingClientRect();
    const layerRect = bubbleLayer.getBoundingClientRect();
    if (hoverBubble) positionBubble(hoverBubble, now, svgRect, layerRect, true);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const age = now - b.bornAt;
      if (age > FIRE_HOLD_MS + 500) {
        b.el.remove();
        bubbles.splice(i, 1);
        continue;
      }
      const opacity =
        age < 200 ? age / 200 :
        age > FIRE_HOLD_MS ? Math.max(0, (FIRE_HOLD_MS + 500 - age) / 500) :
        1;
      positionBubble(b, now, svgRect, layerRect, false, opacity);
    }
  }

  function positionBubble(
    b: ActiveBubble,
    now: number,
    svgRect: DOMRect,
    layerRect: DOMRect,
    pinned: boolean,
    opacity = 1,
  ): void {
    const ep = endpoints.find((e) => e.id === b.endpointId);
    if (!ep) return;
    const p = project(ep.lat, ep.lng, lngOffset, R, cx, cy);
    if (!p.visible) {
      b.el.style.opacity = "0";
      return;
    }
    const sx = (p.x / VB) * svgRect.width;
    const sy = (p.y / VB) * svgRect.height;
    const dx = svgRect.left - layerRect.left + sx;
    const dy = svgRect.top  - layerRect.top  + sy;
    const lift = pinned ? 28 : Math.min(60, (now - b.bornAt) / 35);
    b.el.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, calc(-100% - ${lift}px))`;
    b.el.style.opacity = String(opacity);
  }

  function fireBubble(endpointId: string, text: string, langClass?: string): void {
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return;
    pulses.set(endpointId, performance.now() + 600);
    const el = document.createElement("div");
    el.className = "globe-bubble" + (langClass ? ` ${langClass}` : "");
    el.textContent = text || "(empty)";
    bubbleLayer.appendChild(el);
    bubbles.push({ id: `b${bubbleSeq++}`, endpointId: ep.id, el, bornAt: performance.now() });
  }

  function showBubble(endpointId: string, text: string, langClass?: string): void {
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return;
    clearBubble();
    hoverEndpointId = ep.id;
    const el = document.createElement("div");
    el.className = "globe-bubble is-hover" + (langClass ? ` ${langClass}` : "");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.textContent = text || "(empty)";
    el.addEventListener("click", () => { if (onBubbleClick) onBubbleClick(ep); });
    el.addEventListener("keydown", (ev) => {
      if ((ev as KeyboardEvent).key === "Enter" || (ev as KeyboardEvent).key === " ") {
        ev.preventDefault();
        if (onBubbleClick) onBubbleClick(ep);
      }
    });
    bubbleLayer.appendChild(el);
    hoverBubble = { id: "hover", endpointId: ep.id, el, bornAt: performance.now() };
    redraw(performance.now());
  }

  function clearBubble(): void {
    if (!hoverBubble) return;
    hoverBubble.el.remove();
    hoverBubble = null;
    hoverEndpointId = null;
  }

  function focus(endpointId: string): void {
    const ep = endpoints.find((e) => e.id === endpointId);
    if (!ep) return;
    paused = true;
    lngOffset = normalizeLngOffset(-ep.lng);
    redraw(performance.now());
  }

  function resume(): void {
    paused = false;
    lastFrame = performance.now();
  }

  function setEndpoints(eps: GlobeEndpoint[]): void {
    endpoints = eps;
    rebuildDots();
  }

  function destroy(): void {
    stopped = true;
    container.replaceChildren();
    bubbleLayer.replaceChildren();
  }

  return { fireBubble, showBubble, clearBubble, focus, resume, setEndpoints, destroy };
}

// ---- Projection helpers ------------------------------------------------

const PI = Math.PI;

function project(lat: number, lng: number, lngOffset: number, R: number, cx: number, cy: number) {
  const phi = (lat * PI) / 180;
  const lam = ((lng + lngOffset) * PI) / 180;
  const x = R * Math.cos(phi) * Math.sin(lam);
  const y = R * Math.sin(phi);
  const z = R * Math.cos(phi) * Math.cos(lam);
  return { x: cx + x, y: cy - y, visible: z >= 0 };
}

function normalizeLngOffset(offset: number): number {
  return ((offset % 360) + 360) % 360;
}

function projectFeatures(features: any[], lngOffset: number, R: number, cx: number, cy: number): string {
  const parts: string[] = [];
  for (const f of features) {
    const geom = f?.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) parts.push(projectRing(ring, lngOffset, R, cx, cy));
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates)
        for (const ring of poly) parts.push(projectRing(ring, lngOffset, R, cx, cy));
    }
  }
  return parts.join(" ");
}

function projectRing(ring: number[][], lngOffset: number, R: number, cx: number, cy: number): string {
  let out = "";
  let inSegment = false;
  for (const [lng, lat] of ring) {
    const p = project(lat, lng, lngOffset, R, cx, cy);
    if (!p.visible) {
      inSegment = false;
      continue;
    }
    out += inSegment
      ? `L${p.x.toFixed(1)},${p.y.toFixed(1)} `
      : `M${p.x.toFixed(1)},${p.y.toFixed(1)} `;
    inSegment = true;
  }
  return out;
}
