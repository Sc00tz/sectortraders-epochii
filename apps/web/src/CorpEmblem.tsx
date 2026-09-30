import { useState } from "react";
import { CORP_EMBLEMS, corpEmblemSprite } from "@st/shared";

/** A corporation's emblem. Until the art for one exists, a lettered disc stands in. */
export function CorpEmblem({ id, size = 20, title }: { id: string | null | undefined; size?: number; title?: string }) {
  const [missing, setMissing] = useState(false);
  if (!id) return null;
  const name = CORP_EMBLEMS.find((e) => e.id === id)?.name ?? id;
  if (missing) {
    return <span className="corp-emblem stand-in" style={{ width: size, height: size, fontSize: size * 0.5 }} title={title ?? name}>{name[0]}</span>;
  }
  return <img className="corp-emblem" src={`/sprites/${corpEmblemSprite(id)}.png`} style={{ width: size, height: size }} alt="" title={title ?? name} onError={() => setMissing(true)} />;
}
