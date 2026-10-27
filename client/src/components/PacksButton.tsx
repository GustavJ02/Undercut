import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../hooks";
import { registry, type PackEntry } from "../packs/registry";
import { REPO_URL } from "../legal";
import { loadSettings, saveSettings } from "../settings";

/** A button that opens the content-pack manager: the base pack, the mods found with their validation errors in full, a choice of which
 * to use, and a reload. Mods are data only (names, colours, liveries, people, sounds); see docs/modding.md. */
export function PacksButton({ className = "", onOpenChange }: { className?: string; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpenState] = useState(false);
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} title="Content packs and mods">
        Packs
      </button>
      {open && createPortal(<PackManager onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function PackManager({ onClose }: { onClose: () => void }) {
  const { pack } = useSettings();
  const [entries, setEntries] = useState<PackEntry[]>(registry.entries);
  const [listError, setListError] = useState<string | null>(registry.listError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => {
      setEntries([...registry.entries]);
      setListError(registry.listError);
    };
    const off = registry.subscribe(sync);
    void registry.ensure().then(sync);
    return off;
  }, []);

  const choose = (id: string | null) => saveSettings({ ...loadSettings(), pack: id });
  const reload = async () => {
    setBusy(true);
    await registry.reload();
    setBusy(false);
  };
  return (
    <div className="packs-backdrop" role="dialog" aria-modal="true" aria-label="Content packs" onClick={onClose}>
      <div className="packs" onClick={(e) => e.stopPropagation()}>
        <h2>Content packs</h2>
        <p className="muted small">
          Packs change names, colours, liveries, people and sounds, and never how the race plays. See the <a href={`${REPO_URL}/blob/main/docs/modding.md`} target="_blank" rel="noreferrer">modding guide on GitHub</a> to make your own.
        </p>
        <label className="pack-row">
          <input type="radio" name="pack" checked={!pack} onChange={() => choose(null)} />
          <span>
            <strong>Base pack</strong> <span className="muted small">built in, fictional</span>
          </span>
        </label>
        {entries.map((e) => (
          <div key={`${e.source}/${e.folder}`} className={`pack-entry ${e.ok ? "" : "pack-bad"}`}>
            <label className="pack-row">
              <input type="radio" name="pack" disabled={!e.ok} checked={!!e.id && pack === e.id} onChange={() => e.id && choose(e.id)} />
              <span>
                <strong>{e.name ?? e.folder}</strong> <span className="muted small">{e.id} {e.version} · {e.source}{e.author ? ` · ${e.author}` : ""}</span>
                {!e.ok && <span className="pack-flag"> cannot be used</span>}
              </span>
            </label>
            {e.errors.length > 0 && <pre className="pack-errors">{e.errors.join("\n")}</pre>}
          </div>
        ))}
        {!entries.length && !listError && <p className="muted small">No packs installed besides the base pack.</p>}
        {listError && <p className="muted small">{listError}</p>}
        <div className="swap-row">
          <button onClick={reload} disabled={busy}>
            {busy ? "Reloading…" : "Reload packs"}
          </button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
