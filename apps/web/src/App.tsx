import { useEffect, useState } from "react";
import type { MeDto } from "@st/shared";
import { api } from "./api";
import { Login } from "./Login";
import { Lobby } from "./Lobby";
import { Game } from "./Game";
import { AdminSettings } from "./AdminSettings";
import { Guide } from "./Guide";

export function App() {
  const [me, setMe] = useState<MeDto | null | undefined>(undefined);
  const [gameId, setGameId] = useState<number | null>(() => {
    const m = location.hash.match(/^#game\/(\d+)/);
    return m ? Number(m[1]) : null;
  });
  const [adminId, setAdminId] = useState<number | null>(() => {
    const m = location.hash.match(/^#admin\/(\d+)/);
    return m ? Number(m[1]) : null;
  });

  const [guide, setGuide] = useState(() => location.hash.startsWith("#guide"));

  useEffect(() => { api.me().then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => {
    const onHash = () => setGuide(location.hash.startsWith("#guide"));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    if (guide) return;
    const target = gameId ? `#game/${gameId}` : adminId ? `#admin/${adminId}` : "";
    if (location.hash !== target) history.replaceState(null, "", target || location.pathname);
  }, [gameId, adminId, guide]);

  // The guide is open to everyone, signed in or not.
  if (guide) return <Guide backLabel="Back" onBack={() => { history.replaceState(null, "", location.pathname); setGuide(false); }} />;
  if (me === undefined) return <div className="center muted">Loading…</div>;
  if (!me) return <Login onLogin={setMe} />;
  const logout = async () => { await api.logout(); setMe(null); setGameId(null); };
  if (adminId && me.isAdmin) return <AdminSettings gameId={adminId} onBack={() => setAdminId(null)} />;
  if (gameId) return <Game gameId={gameId} me={me} onExit={() => setGameId(null)} onLogout={logout} />;
  return <Lobby me={me} onEnter={setGameId} onAdmin={setAdminId} onLogout={logout} />;
}
