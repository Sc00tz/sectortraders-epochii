import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@st/shared";
import { generateUniverse, plotCourse } from "./universe";

function adjacency(warps: [number, number][]) {
  const adj = new Map<number, number[]>();
  for (const [a, b] of warps) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  }
  return adj;
}

function reachable(adj: Map<number, number[]>, start: number) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) for (const v of adj.get(stack.pop()!) ?? []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  return seen;
}

describe("universe generator", () => {
  for (const sectors of [100, 1000, 5000]) {
    it(`builds a valid ${sectors}-sector universe`, () => {
      const s = { ...DEFAULT_SETTINGS, sectors };
      const u = generateUniverse(s, 12345);
      expect(u.sectors).toHaveLength(sectors);
      const adj = adjacency(u.warps);
      // Every sector reachable from sector 1, and sector 1 reachable from every sector (reverse graph).
      expect(reachable(adj, 1).size).toBe(sectors);
      const rev = adjacency(u.warps.map(([a, b]) => [b, a] as [number, number]));
      expect(reachable(rev, 1).size).toBe(sectors);
      // Warp cap: outbound warps per sector.
      for (const [, v] of adj) expect(v.length).toBeLessThanOrEqual(s.maxWarpsPerSector);
      // FedSpace and specials.
      expect(u.sectors.filter((x) => x.id <= 10).every((x) => x.fedspace)).toBe(true);
      expect(u.sectors.find((x) => x.id === u.stardock)!.fedspace).toBe(true);
      expect(u.ports.find((p) => p.sectorId === 1)!.cls).toBe(0);
      expect(u.ports.filter((p) => p.cls === 0)).toHaveLength(3);
      // Port density roughly as configured.
      const ratio = u.ports.length / sectors;
      expect(ratio).toBeGreaterThan(0.3);
      expect(ratio).toBeLessThan(0.48);
    });
  }

  it("is deterministic for a seed", () => {
    const s = { ...DEFAULT_SETTINGS, sectors: 300 };
    expect(generateUniverse(s, 7)).toEqual(generateUniverse(s, 7));
  });

  it("plots shortest courses", () => {
    const adj = adjacency([[1, 2], [2, 3], [3, 4], [1, 4]]);
    expect(plotCourse(adj, 1, 4, 10)).toEqual([4]);
    expect(plotCourse(adj, 2, 4, 10)).toEqual([3, 4]);
    expect(plotCourse(adj, 4, 1, 10)).toBeNull();
  });
});
