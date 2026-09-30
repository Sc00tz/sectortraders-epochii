import { useMemo, useState } from "react";
import {
  DEFAULT_SETTINGS, SETTINGS_META, SETTING_GROUPS, SHIP_TYPES, getSetting,
  type GameSettings, type SettingMeta,
} from "@st/shared";
import { fmt } from "./api";

type Draft = Record<string, string | boolean>;

/** A setting as the form shows it: percentages as whole-ish numbers, everything else as typed. */
function shown(m: SettingMeta, v: number | boolean | string): string | boolean {
  if (m.kind === "bool" || m.kind === "ship") return v as boolean | string;
  const n = Number(v);
  return String(m.kind === "pct" ? Math.round(n * 100 * 1000) / 1000 : n);
}
function stored(m: SettingMeta, v: string | boolean): unknown {
  if (m.kind === "bool" || m.kind === "ship") return v;
  const n = Number(v);
  return m.kind === "pct" ? n / 100 : n;
}
function display(m: SettingMeta, v: number | boolean | string) {
  if (m.kind === "bool") return v ? "on" : "off";
  if (m.kind === "ship") return SHIP_TYPES[String(v)]?.name ?? String(v);
  if (m.kind === "pct") return `${Math.round(Number(v) * 100 * 1000) / 1000}%`;
  return fmt(Number(v));
}

/**
 * Every game setting, grouped, with defaults and limits. `mode="edit"` locks creation-only settings;
 * `mode="create"` lets them all be set. `onSave` gets only the changed keys (pct as fractions).
 */
export function SettingsForm({ current, mode, busy, onSave, saveLabel }: {
  current: GameSettings; mode: "edit" | "create"; busy: boolean;
  onSave: (patch: Record<string, unknown>) => void; saveLabel: string;
}) {
  const [draft, setDraft] = useState<Draft>({});
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const changed = useMemo(() => Object.keys(draft).filter((k) => {
    const m = SETTINGS_META.find((x) => x.key === k)!;
    return draft[k] !== shown(m, getSetting(current, k));
  }), [draft, current]);

  const q = filter.trim().toLowerCase();
  const rows = SETTINGS_META.filter((m) => !q || m.label.toLowerCase().includes(q) || m.group.toLowerCase().includes(q) || (m.help ?? "").toLowerCase().includes(q));

  const input = (m: SettingMeta) => {
    const locked = mode === "edit" && !!m.creation;
    const value = m.key in draft ? draft[m.key]! : shown(m, getSetting(current, m.key));
    const set = (v: string | boolean) => setDraft({ ...draft, [m.key]: v });
    if (m.kind === "bool") return <input type="checkbox" disabled={locked} checked={!!value} onChange={(e) => set(e.target.checked)} />;
    if (m.kind === "ship") {
      return (
        <select disabled={locked} value={String(value)} onChange={(e) => set(e.target.value)}>
          {Object.values(SHIP_TYPES).filter((t) => t.buyable && !t.requires).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      );
    }
    return (
      <span className="setting-input">
        <input className="num" disabled={locked} value={String(value)} inputMode="decimal"
          onChange={(e) => set(e.target.value.replace(/[^\d.-]/g, ""))} />
        {m.kind === "pct" && <span className="muted">%</span>}
      </span>
    );
  };

  const save = () => {
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = stored(SETTINGS_META.find((m) => m.key === k)!, draft[k]!);
    onSave(patch);
  };

  return (
    <div className="settings-form">
      <div className="settings-toolbar">
        <input placeholder="Find a setting" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="spacer" />
        {changed.length > 0 && <button className="link" onClick={() => setDraft({})}>Discard changes</button>}
        <button className="primary" disabled={busy || (mode === "edit" && changed.length === 0)} onClick={save}>
          {saveLabel}{mode === "edit" && changed.length ? ` (${changed.length})` : ""}
        </button>
      </div>
      {SETTING_GROUPS.map((g) => {
        const list = rows.filter((m) => m.group === g);
        if (!list.length) return null;
        const isOpen = q ? true : open[g] ?? (mode === "create" ? g.startsWith("Galaxy") : false);
        const dirty = list.filter((m) => changed.includes(m.key)).length;
        return (
          <section key={g} className="settings-group">
            <button className="settings-head" onClick={() => setOpen({ ...open, [g]: !isOpen })}>
              <span>{isOpen ? "▾" : "▸"} {g}</span>
              {dirty > 0 && <span className="badge fed">{dirty} changed</span>}
            </button>
            {isOpen && (
              <table className="settings-table">
                <tbody>
                  {list.map((m) => {
                    const def = getSetting(DEFAULT_SETTINGS, m.key);
                    const cur = m.key in draft ? stored(m, draft[m.key]!) : getSetting(current, m.key);
                    const custom = String(cur) !== String(def);
                    return (
                      <tr key={m.key} className={changed.includes(m.key) ? "changed" : ""}>
                        <td className="setting-label">
                          {m.label}
                          {(m.help || m.when) && <div className="muted small">{m.help}{m.help && m.when ? " " : ""}{m.when && `Applies ${m.when}.`}</div>}
                        </td>
                        <td>{input(m)}</td>
                        <td className="muted small setting-default">
                          {mode === "edit" && m.creation ? "fixed for this galaxy" : custom ? <>
                            default {display(m, def)}
                            {" "}<button className="link" onClick={() => setDraft({ ...draft, [m.key]: shown(m, def) })}>reset</button>
                          </> : "default"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
