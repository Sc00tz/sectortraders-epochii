import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import type { MapDto } from "@st/shared";
import { api } from "./api";

const COLORS = {
  warp: 0x3a4a78,
  route: 0xffd24a,
  visited: 0x8fa3c8,
  unvisited: 0x3b4666,
  port: 0xf2b84b,
  special: 0x5ee0ff,
  current: 0x7dff9b,
};

/**
 * Explored-space map. Only sectors you've visited (and their neighbours) appear.
 * Scroll to zoom, drag to pan, click a sector to plot a course.
 */
export function GalaxyMap({ gameId, current, route, onPick }: {
  gameId: number; current: number; route: number[] | null; onPick: (id: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const world = useRef<Container | null>(null);
  const [data, setData] = useState<MapDto | null>(null);
  const [ready, setReady] = useState(false);
  const centred = useRef(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => { api.map(gameId).then(setData).catch(() => {}); }, [gameId, current]);

  // Pixi app with pan and zoom.
  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    app.init({ resizeTo: host.current!, background: "#04050b", antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 })
      .then(() => {
        if (cancelled) { app.destroy(true); return; }
        host.current!.appendChild(app.canvas);
        const w = new Container();
        app.stage.addChild(w);
        app.stage.eventMode = "static";
        app.stage.hitArea = app.screen;
        let drag: { x: number; y: number } | null = null;
        let moved = 0;
        app.stage.on("pointerdown", (e: FederatedPointerEvent) => { drag = { x: e.global.x, y: e.global.y }; moved = 0; });
        app.stage.on("pointerup", () => { drag = null; });
        app.stage.on("pointerupoutside", () => { drag = null; });
        app.stage.on("pointermove", (e: FederatedPointerEvent) => {
          if (!drag) return;
          w.x += e.global.x - drag.x; w.y += e.global.y - drag.y;
          moved += Math.abs(e.global.x - drag.x) + Math.abs(e.global.y - drag.y);
          drag = { x: e.global.x, y: e.global.y };
        });
        (w as Container & { wasDragged?: () => boolean }).wasDragged = () => moved > 4;
        app.canvas.addEventListener("wheel", (ev) => {
          ev.preventDefault();
          const rect = app.canvas.getBoundingClientRect();
          const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
          const factor = Math.exp(-ev.deltaY * 0.0015);
          const next = Math.min(12, Math.max(0.3, w.scale.x * factor));
          const k = next / w.scale.x;
          w.x = mx - (mx - w.x) * k; w.y = my - (my - w.y) * k;
          w.scale.set(next);
          app.stage.emit("zoomed");
        }, { passive: false });
        new ResizeObserver(() => { if (appRef.current === app) app.resize(); }).observe(host.current!);
        appRef.current = app;
        world.current = w;
        setReady(true);
      });
    return () => {
      cancelled = true;
      if (appRef.current) { appRef.current.destroy(true, { children: true }); appRef.current = null; }
    };
  }, []);

  // Draw the explored map.
  useEffect(() => {
    const app = appRef.current, w = world.current;
    if (!ready || !app || !w || !data) return;
    w.removeChildren().forEach((c) => c.destroy({ children: true }));
    const byId = new Map(data.sectors.map((s) => [s.id, s]));

    if (!centred.current) {
      const cur = byId.get(data.current);
      w.scale.set(3);
      if (cur) { w.x = app.screen.width / 2 - cur.x * 3; w.y = app.screen.height / 2 - cur.y * 3; }
      centred.current = true;
    }

    const lines = new Graphics();
    for (const s of data.sectors) {
      for (const t of s.warps) {
        const d = byId.get(t);
        if (!d) continue;
        const oneWay = !d.visited || !d.warps.includes(s.id);
        if (!oneWay && t < s.id) continue; // draw two-way links once
        lines.moveTo(s.x, s.y).lineTo(d.x, d.y).stroke({ width: oneWay ? 0.35 : 0.6, color: COLORS.warp, alpha: oneWay ? 0.6 : 1 });
      }
    }
    if (route?.length) {
      const pts = [data.current, ...route].map((id) => byId.get(id)).filter(Boolean) as { x: number; y: number }[];
      for (let i = 1; i < pts.length; i++) lines.moveTo(pts[i - 1]!.x, pts[i - 1]!.y).lineTo(pts[i]!.x, pts[i]!.y).stroke({ width: 1.2, color: COLORS.route });
    }
    w.addChild(lines);

    const wasDragged = (w as Container & { wasDragged?: () => boolean }).wasDragged ?? (() => false);
    const labels: Text[] = [];
    for (const s of data.sectors) {
      const g = new Graphics();
      const isCur = s.id === data.current;
      const color = isCur ? COLORS.current : s.port === "Special" || s.port === "Keystone" ? COLORS.special : s.port ? COLORS.port : s.visited ? COLORS.visited : COLORS.unvisited;
      if (s.visited || isCur) g.circle(0, 0, isCur ? 2.6 : 1.8).fill({ color });
      else g.circle(0, 0, 1.5).stroke({ width: 0.5, color });
      if (isCur) g.circle(0, 0, 4.5).stroke({ width: 0.6, color: COLORS.current });
      g.position.set(s.x, s.y);
      g.eventMode = "static";
      g.cursor = "pointer";
      g.hitArea = { contains: (x: number, y: number) => x * x + y * y < 16 };
      g.on("pointertap", () => { if (!wasDragged()) pickRef.current(s.id); });
      w.addChild(g);

      const label = new Text({
        text: s.port ? `${s.id} ${s.port}` : String(s.id),
        style: { fill: s.visited ? 0xc9d6f2 : 0x6b7796, fontSize: 24, fontFamily: "Inter, sans-serif" },
      });
      label.scale.set(0.12);
      label.position.set(s.x + 3, s.y - 3.5);
      w.addChild(label);
      labels.push(label);
    }
    // Hide labels when zoomed far out.
    const syncLabels = () => { const show = w.scale.x > 1.6; for (const l of labels) l.visible = show; };
    syncLabels();
    app.stage.on("zoomed", syncLabels);
    // The app may already be destroyed when this cleanup runs on unmount.
    return () => { app.stage?.off("zoomed", syncLabels); };
  }, [ready, data, route]);

  return (
    <div className="map-wrap">
      <div className="pixi-host" ref={host} />
      <div className="map-legend">
        <span><i style={{ background: "#7dff9b" }} />You</span>
        <span><i style={{ background: "#f2b84b" }} />Port</span>
        <span><i style={{ background: "#5ee0ff" }} />Special</span>
        <span><i style={{ background: "#8fa3c8" }} />Visited</span>
        <span><i className="hollow" />Seen, not visited</span>
        <span className="muted">Scroll to zoom · drag to pan · click a sector to plot a course</span>
      </div>
    </div>
  );
}
