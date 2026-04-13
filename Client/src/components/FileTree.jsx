import { useState, useRef, useEffect, useCallback } from "react";

// ── small icon components ─────────────────────────────────────────────────────
function IconFolder({ open }) {
  return <span className="ft-icon ft-icon--folder">{open ? "▾" : "▸"}</span>;
}
function IconFile({ name }) {
  const ext = (name || "").split(".").pop().toLowerCase();
  const label = (ext || "txt").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TXT";
  const colors = {
    js:"#f7df1e", jsx:"#61dafb", ts:"#3178c6", tsx:"#61dafb",
    py:"#3572a5", java:"#b07219", cpp:"#f34b7d", c:"#555555",
    cs:"#178600", html:"#e34c26", css:"#563d7c", json:"#292929",
    md:"#083fa1", sh:"#89e051", go:"#00add8", rs:"#dea584",
    php:"#4f5d95", rb:"#701516",
  };
  const color = colors[ext] || "#8b949e";
  return (
    <span className="ft-icon ft-icon--file-badge" style={{ color }}>
      <span className="ft-icon__diamond" style={{ borderColor: color, backgroundColor: `${color}33` }} />
      <span className="ft-icon__ext">{label}</span>
    </span>
  );
}

// ── context menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className="ft-ctx" style={{ top: y, left: x }}>
      {items.map((item, i) =>
        item === "---"
          ? <div key={i} className="ft-ctx__divider" />
          : <button key={i} className="ft-ctx__item" onClick={() => { item.action(); onClose(); }}>
              {item.label}
            </button>
      )}
    </div>
  );
}

// ── inline rename input ───────────────────────────────────────────────────────
function RenameInput({ defaultValue, onCommit, onCancel }) {
  const [val, setVal] = useState(defaultValue);
  const ref = useRef(null);
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      className="ft-rename-input"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); if (val.trim()) onCommit(val.trim()); }
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => { if (val.trim()) onCommit(val.trim()); else onCancel(); }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// ── new-item input (shown inline in tree) ─────────────────────────────────────
function NewItemInput({ onCommit, onCancel, placeholder }) {
  const [val, setVal] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="ft-new-input-row">
      <input
        ref={ref}
        className="ft-rename-input"
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); if (val.trim()) onCommit(val.trim()); }
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => { if (val.trim()) onCommit(val.trim()); else onCancel(); }}
      />
    </div>
  );
}

// ── main FileTree component ───────────────────────────────────────────────────
export default function FileTree({
  files,
  folders,
  activeFileId,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
}) {
  const [expanded,  setExpanded]  = useState(new Set());
  const [renaming,  setRenaming]  = useState(null); // { id, type }
  const [creating,  setCreating]  = useState(null); // { parentId, type: "file"|"folder" }
  const [ctxMenu,   setCtxMenu]   = useState(null); // { x, y, id, type }

  const toggleFolder = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openCtx = useCallback((e, id, type) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, id, type });
  }, []);

  // ── build tree nodes sorted: folders first, then files, alpha ─────────────
  function renderChildren(parentId, depth) {
    const childFolders = Object.values(folders)
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));

    const childFiles = Object.values(files)
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));

    return (
      <>
        {childFolders.map((folder) => {
          const isOpen = expanded.has(folder.id);
          return (
            <div key={folder.id}>
              <div
                className="ft-row ft-row--folder"
                style={{ paddingLeft: 8 + depth * 16 }}
                onClick={() => toggleFolder(folder.id)}
                onContextMenu={(e) => openCtx(e, folder.id, "folder")}
              >
                <IconFolder open={isOpen} />
                {renaming?.id === folder.id && renaming.type === "folder" ? (
                  <RenameInput
                    defaultValue={folder.name}
                    onCommit={(name) => { onRenameFolder(folder.id, name); setRenaming(null); }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className="ft-label">{folder.name}</span>
                )}
              </div>
              {isOpen && (
                <div>
                  {creating?.parentId === folder.id && (
                    <div style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
                      <NewItemInput
                        placeholder={creating.type === "file" ? "filename.js" : "folder name"}
                        onCommit={(name) => {
                          if (creating.type === "file") onCreateFile(name, folder.id);
                          else onCreateFolder(name, folder.id);
                          setCreating(null);
                        }}
                        onCancel={() => setCreating(null)}
                      />
                    </div>
                  )}
                  {renderChildren(folder.id, depth + 1)}
                </div>
              )}
            </div>
          );
        })}

        {childFiles.map((file) => (
          <div
            key={file.id}
            className={`ft-row ft-row--file ${activeFileId === file.id ? "ft-row--active" : ""}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => onOpenFile(file.id)}
            onContextMenu={(e) => openCtx(e, file.id, "file")}
          >
            <IconFile name={file.name} />
            {renaming?.id === file.id && renaming.type === "file" ? (
              <RenameInput
                defaultValue={file.name}
                onCommit={(name) => { onRenameFile(file.id, name); setRenaming(null); }}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <span className="ft-label">{file.name}</span>
            )}
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="file-tree">
      {/* ── header bar ── */}
      <div className="ft-header">
        <span className="ft-header__title">EXPLORER</span>
        <div className="ft-header__actions">
          <button
            className="ft-header__btn"
            title="New file"
            onClick={() => setCreating({ parentId: null, type: "file" })}
          >+F</button>
          <button
            className="ft-header__btn"
            title="New folder"
            onClick={() => setCreating({ parentId: null, type: "folder" })}
          >+D</button>
        </div>
      </div>

      {/* ── tree body ── */}
      <div className="ft-body">
        {/* root-level new-item input */}
        {creating?.parentId === null && (
          <div style={{ paddingLeft: 8 }}>
            <NewItemInput
              placeholder={creating.type === "file" ? "filename.js" : "folder name"}
              onCommit={(name) => {
                if (creating.type === "file") onCreateFile(name, null);
                else onCreateFolder(name, null);
                setCreating(null);
              }}
              onCancel={() => setCreating(null)}
            />
          </div>
        )}

        {renderChildren(null, 0)}

        {Object.keys(files).length === 0 && Object.keys(folders).length === 0 && !creating && (
          <p className="ft-empty">No files yet.<br />Click +F to create one.</p>
        )}
      </div>

      {/* ── context menu ── */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={
            ctxMenu.type === "folder"
              ? [
                  { label: "New file inside",   action: () => { setExpanded((p) => new Set([...p, ctxMenu.id])); setCreating({ parentId: ctxMenu.id, type: "file" }); } },
                  { label: "New folder inside",  action: () => { setExpanded((p) => new Set([...p, ctxMenu.id])); setCreating({ parentId: ctxMenu.id, type: "folder" }); } },
                  "---",
                  { label: "Rename",  action: () => setRenaming({ id: ctxMenu.id, type: "folder" }) },
                  { label: "Delete",  action: () => { if (window.confirm("Delete folder and all its contents?")) onDeleteFolder(ctxMenu.id); } },
                ]
              : [
                  { label: "Open",    action: () => onOpenFile(ctxMenu.id) },
                  "---",
                  { label: "Rename",  action: () => setRenaming({ id: ctxMenu.id, type: "file" }) },
                  { label: "Delete",  action: () => { if (window.confirm(`Delete ${files[ctxMenu.id]?.name}?`)) onDeleteFile(ctxMenu.id); } },
                ]
          }
        />
      )}
    </div>
  );
}

