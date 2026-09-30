import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { FACTIONS, corpEmblemSprite, makeRng, PLANET_CLASSES, SHIP_TYPES, type PlanetClassId, type SectorDto } from "@st/shared";

export function stationSpriteFor(port: { cls: number; name: string }) {
  if (port.cls === 9) return "station_stardock";
  // The three depots: Deepstone (asteroid) and Ringwall (ring); galaxies made before the rename used Outer and Frontier.
  if (port.cls === 0) return /^(Deepstone|Outer)/.test(port.name) ? "station_special_asteroid" : /^(Ringwall|Frontier)/.test(port.name) ? "station_special_ring" : "station_special_home";
  return "station_trade_port";
}

const FACTION_COLOR = { authority: 0x8fb8ff, maw: 0xff8a7a, vey: 0xd0a8ff } as const;

/** Seeded backdrop: every sector always looks the same, and different from its neighbours. */
function drawBackdrop(g: Graphics, w: number, h: number, seed: number) {
  const rng = makeRng(seed * 7919 + 17);
  g.rect(0, 0, w, h).fill({ color: 0x05060d });
  const hues = [0x3b1f6b, 0x10365c, 0x4a1633, 0x0f4a4a, 0x3d2a10];
  for (let i = 0; i < 4; i++) {
    const cx = rng.next() * w, cy = rng.next() * h, r = 120 + rng.next() * 220;
    const color = rng.pick(hues);
    for (let k = 6; k > 0; k--) g.circle(cx, cy, (r * k) / 6).fill({ color, alpha: 0.05 });
  }
  for (let i = 0; i < 260; i++) {
    const size = rng.next() < 0.93 ? 1.5 : 3;
    g.rect(Math.floor(rng.next() * w), Math.floor(rng.next() * h), size, size)
      .fill({ color: rng.next() < 0.8 ? 0xffffff : rng.pick([0xffd28a, 0x9fd4ff, 0xff9fb0]), alpha: 0.35 + rng.next() * 0.65 });
  }
}

export function SectorScene({ sector, shipSprite }: { sector: SectorDto; shipSprite: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layer = useRef<Container | null>(null);

  // Create the Pixi app once.
  useEffect(() => {
    let cancelled = false;
    const app = new Application();
    app.init({ resizeTo: host.current!, background: "#05060d", antialias: false, autoDensity: true, resolution: window.devicePixelRatio || 1 })
      .then(() => {
        if (cancelled) { app.destroy(true); return; }
        host.current!.appendChild(app.canvas);
        layer.current = new Container();
        app.stage.addChild(layer.current);
        appRef.current = app;
        host.current!.dispatchEvent(new Event("pixi-ready"));
      });
    return () => {
      cancelled = true;
      if (appRef.current) { appRef.current.destroy(true, { children: true }); appRef.current = null; }
    };
  }, []);

  // Redraw whenever the sector changes (or the canvas is resized).
  useEffect(() => {
    const el = host.current!;
    let stale = false;
    const draw = async () => {
      const app = appRef.current, root = layer.current;
      if (!app || !root) return;
      const w = app.screen.width, h = app.screen.height;
      const spriteOf = (ship: string) => SHIP_TYPES[ship]?.sprite ?? null;
      const planetSprite = (cls: string) => PLANET_CLASSES[cls as PlanetClassId]?.sprite ?? "planet_m";
      const names = [shipSprite, ...(sector.port ? [stationSpriteFor(sector.port)] : []), ...sector.traders.map((t) => spriteOf(t.ship)),
        ...sector.traders.flatMap((t) => (t.npc ? [FACTIONS[t.npc.faction].emblem] : t.corpEmblem ? [corpEmblemSprite(t.corpEmblem)] : [])),
        ...sector.planets.flatMap((pl) => [planetSprite(pl.cls), ...(pl.citadel ? [`citadel_${pl.citadel}`] : [])])]
        .filter((n): n is string => !!n);
      const tex = new Map<string, Texture>();
      // A missing sprite (art not made yet) is skipped rather than breaking the scene.
      for (const n of new Set(names)) { try { tex.set(n, await Assets.load<Texture>(`/sprites/${n}.png`)); } catch { /* no art yet */ } }
      /** Ship sprite, or a small drawn capsule for escape pods (no art yet). */
      const shipNode = (sprite: string | null, px: number) => {
        if (sprite) {
          const s = new Sprite(tex.get(sprite)!);
          s.anchor.set(0.5);
          s.scale.set(px / Math.max(s.texture.width, s.texture.height));
          return s;
        }
        const g = new Graphics();
        const r = px * 0.16;
        g.roundRect(-r * 1.6, -r, r * 3.2, r * 2, r).fill({ color: 0xc9d2e6 }).stroke({ width: 3, color: 0x1a1f33 });
        g.circle(-r * 0.4, 0, r * 0.55).fill({ color: 0x5ee0ff });
        g.rect(r * 1.6, -r * 0.5, r * 0.6, r).fill({ color: 0xff9a3c });
        return g;
      };
      if (stale) return;
      root.removeChildren().forEach((c) => c.destroy());

      const bg = new Graphics();
      drawBackdrop(bg, w, h, sector.id);
      root.addChild(bg);

      const scale = (s: Sprite, px: number) => { s.scale.set(px / Math.max(s.texture.width, s.texture.height)); };
      // Planets sit in the background: a row across the top-right when there's a port, bigger otherwise.
      // With a port, the row shrinks to fit the right two-thirds so a full sector of planets doesn't spill left.
      const shown = Math.min(5, sector.planets.length);
      const pr = sector.port ? Math.min(Math.min(h, w) * 0.13, (w * (w < 600 ? 0.52 : 0.64)) / (shown * 2.4)) : Math.min(h, w) * 0.2;
      // Planet names go on top of everything so the station never hides them.
      const planetLabels: Text[] = [];
      const stagger = !!sector.port && shown >= 3 && pr * 2.4 < 80;
      sector.planets.slice(0, 5).forEach((pl, i) => {
        const anyCitadel = sector.planets.some((q) => q.citadel);
        const x = sector.port ? w - pr * 1.3 - i * pr * 2.4 : w * (0.62 + (i % 3) * 0.15);
        const y = sector.port ? pr * (anyCitadel ? 2.0 : 1.3) : h * (0.3 + Math.floor(i / 3) * 0.38) + (anyCitadel ? pr * 0.3 : 0);
        const sp = new Sprite(tex.get(planetSprite(pl.cls))!);
        sp.anchor.set(0.5);
        scale(sp, pr * 2);
        sp.position.set(x, y);
        root.addChild(sp);
        if (pl.citadel) {
          // Seat the citadel on the planet's top limb and clip whatever dips below the surface,
          // so the base reads as built into the ground rather than hovering beside it.
          const surf = pr * (494 / 512); // planet art has ~9px of padding in a 512 frame
          const cit = new Sprite(tex.get(`citadel_${pl.citadel}`)!);
          cit.anchor.set(0.5, 0.78);
          scale(cit, pr * 1.2);
          cit.position.set(x, y - surf + pr * 0.12);
          const clip = new Graphics()
            .rect(x - pr * 2, y - pr * 3, pr * 4, pr * 4).fill({ color: 0xffffff })
            .circle(x, y, surf - pr * 0.06).cut();
          cit.mask = clip;
          root.addChild(clip, cit);
        }
        // Names wrap to the planet's width so neighbours in a crowded row don't run together.
        const label = new Text({ text: pl.name, style: { fill: pl.mine ? 0x7dff9b : pl.owner ? 0xff9fa8 : 0xd6e2ff, fontSize: stagger ? 10 : shown >= 3 ? 11 : 12, fontFamily: "Inter, sans-serif", align: "center", wordWrap: !stagger, wordWrapWidth: Math.max(60, pr * 2.3) } });
        label.anchor.set(0.5, 0);
        // Tight rows alternate names between two lines so they don't collide.
        const lx = Math.min(Math.max(x, label.width / 2 + 4), w - label.width / 2 - 4); // keep names inside the frame
        label.position.set(lx, y + pr + 2 + (stagger && i % 2 ? 13 : 0));
        planetLabels.push(label);
      });

      if (sector.port) {
        const st = new Sprite(tex.get(stationSpriteFor(sector.port))!);
        st.anchor.set(0.5);
        if (shown >= 3) {
          // A crowded sector: the planets get a band across the top and the station sits below it.
          const band = pr * (sector.planets.some((q) => q.citadel) ? 2.0 : 1.3) + pr + (stagger ? 46 : 34);
          const size = Math.max(h * 0.35, Math.min(h - band - 8, w * 0.42));
          scale(st, size);
          st.position.set(w * 0.68, Math.min(h - size / 2 - 4, band + size / 2));
        } else {
          scale(st, Math.min(h * 0.8, w * 0.42));
          st.position.set(w * 0.68, h * 0.48);
        }
        root.addChild(st);
      }
      const mine = shipNode(shipSprite, Math.min(h * 0.42, w * 0.26));
      mine.position.set(w * 0.25, h * 0.58);
      root.addChild(mine);

      sector.traders.slice(0, 6).forEach((t, i) => {
        const s = shipNode(spriteOf(t.ship), Math.min(h * 0.2, w * 0.13));
        const x = w * (0.1 + (i % 3) * 0.15), y = h * (0.2 + Math.floor(i / 3) * 0.22);
        s.position.set(x, y);
        // A Vey pilot in a borrowed hull gets a violet cast so it still reads as alien.
        if (t.npc?.faction === "vey" && !t.ship.startsWith("vey_") && s instanceof Sprite) s.tint = 0xd2b4ff;
        root.addChild(s);
        const fill = t.npc ? FACTION_COLOR[t.npc.faction] : 0xd6e2ff;
        // Wrap long names so neighbours' labels don't run into each other.
        const label = new Text({ text: t.alias, style: { fill, fontSize: 12, fontFamily: "Inter, sans-serif", align: "center", wordWrap: true, wordWrapWidth: w * 0.13 } });
        label.anchor.set(0.5, 0);
        label.position.set(x, y + s.height / 2 + 2);
        root.addChild(label);
        const emTex = t.npc ? tex.get(FACTIONS[t.npc.faction].emblem) : t.corpEmblem ? tex.get(corpEmblemSprite(t.corpEmblem)) : undefined;
        if (emTex) {
          const em = new Sprite(emTex);
          em.anchor.set(1, 0);
          scale(em, 18);
          em.position.set(x - label.width / 2 - 3, y + s.height / 2);
          root.addChild(em);
        }
      });

      for (const l of planetLabels) root.addChild(l);

      const title = new Text({ text: `SECTOR ${sector.id}`, style: { fill: 0xffe08a, fontSize: 18, fontFamily: "Silkscreen, monospace", letterSpacing: 2 } });
      title.position.set(14, 10);
      root.addChild(title);
    };
    // Pixi's resizeTo only listens for window resizes; the panel can change size on its own.
    const ro = new ResizeObserver(() => { appRef.current?.resize(); draw(); });
    el.addEventListener("pixi-ready", draw);
    ro.observe(el);
    draw();
    return () => { stale = true; ro.disconnect(); el.removeEventListener("pixi-ready", draw); };
  }, [sector, shipSprite]);

  return <div className="pixi-host" ref={host} />;
}
