const EXT_COLORS = {
  js:"#f7df1e", jsx:"#61dafb", ts:"#3178c6", tsx:"#61dafb",
  py:"#3572a5", java:"#b07219", cpp:"#f34b7d", c:"#555555",
  cs:"#178600", html:"#e34c26", css:"#563d7c", json:"#8b949e",
  md:"#083fa1", sh:"#89e051", go:"#00add8", rs:"#dea584",
};

function extColor(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  return EXT_COLORS[ext] || "#8b949e";
}

export default function TabBar({ files, openTabs, activeFileId, onActivate, onClose }) {
  if (!openTabs.length) return null;

  return (
    <div className="tab-bar">
      {openTabs.map((id) => {
        const file   = files[id];
        const name   = file?.name || id;
        const active = id === activeFileId;
        const color  = extColor(name);

        return (
          <div
            key={id}
            className={`tab ${active ? "tab--active" : ""}`}
            onClick={() => onActivate(id)}
            title={name}
          >
            <span className="tab__dot" style={{ color }}>◆</span>
            <span className="tab__name">{name}</span>
            <button
              className="tab__close"
              onClick={(e) => { e.stopPropagation(); onClose(id); }}
              title="Close tab"
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
