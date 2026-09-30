/** Pixel-art item icons in /sprites/icon_*.png. Keys are the game's internal item ids. */
const FILE: Record<string, string> = {
  ore: "ore", org: "org", equ: "equ", colonists: "colonists",
  fighters: "fighters", shields: "shields", holds: "holds",
  armid: "armid", limpet: "limpet", genesis: "genesis",
  transwarp: "transwarp", density: "density", holo: "holo", planetScanner: "planet_scanner",
  probe: "probe", photon: "photon", cloak: "cloak", corbomite: "corbomite",
  disruptor: "disruptor", detonator: "detonator", beacon: "beacon",
};

export function Icon({ item, size = 20 }: { item: string; size?: number }) {
  const f = FILE[item];
  if (!f) return null;
  return <img className="item-icon" src={`/sprites/icon_${f}.png`} width={size} height={size} style={{ width: size, height: size }} alt="" />;
}
