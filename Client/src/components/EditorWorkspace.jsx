import { lazy, Suspense } from "react";
import MonacoEditor from "@monaco-editor/react";
import FileTree from "../components/FileTree";
import MemberManager from "../components/MemberManager";
import SnapshotPanel from "../components/SnapshotPanel";
import TabBar from "../components/TabBar";
import { useTheme } from "../context/ThemeContext.jsx";

const RunTerminal = lazy(() => import("../components/RunTerminal.jsx"));

export default function EditorWorkspace({
  sidebarOpen,
  files,
  folders,
  activeFileId,
  openTabs,
  openFile,
  closeTab,
  handleCreateFile,
  handleCreateFolder,
  handleRenameFile,
  handleRenameFolder,
  handleDeleteFile,
  handleDeleteFolder,
  userRole,
  permissions,
  uploadInputRef,
  uploadStatus,
  handleUpload,
  roomId,
  joined,
  filesLoaded,
  editorKey,
  handleEditorMount,
  monacoOptions,
  terminalOpen,
  getRunCode,
  activeFile,
  editorNotification,
  onSnapshotRestored,
}) {
  const { isDark } = useTheme();

  return (
    <div className="editor-workspace">
      {sidebarOpen && (
        <aside className="editor-sidebar">
          <FileTree
            files={files}
            folders={folders}
            activeFileId={activeFileId}
            onOpenFile={openFile}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRenameFile={handleRenameFile}
            onRenameFolder={handleRenameFolder}
            onDeleteFile={handleDeleteFile}
            onDeleteFolder={handleDeleteFolder}
            userRole={userRole}
            permissions={permissions}
          />

          <div className="sidebar-upload">
            <input
              ref={uploadInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              className="sidebar-upload__input"
              onChange={handleUpload}
            />
            <button
              className="sidebar-upload-btn"
              onClick={() => uploadInputRef.current?.click()}
              disabled={Boolean(uploadStatus) || !permissions?.canEditFiles}
            >
              {uploadStatus
                ? uploadStatus
                : !permissions?.canEditFiles
                  ? "View Only"
                  : "Upload Folder"}
            </button>
          </div>

          <MemberManager roomId={roomId} userRole={userRole} permissions={permissions} />
          <SnapshotPanel roomId={roomId} permissions={permissions} onRestored={onSnapshotRestored} />
        </aside>
      )}

      <div className="editor-main">
        <TabBar
          files={files}
          openTabs={openTabs}
          activeFileId={activeFileId}
          onActivate={openFile}
          onClose={closeTab}
        />

        <div className={`editor-main__split${terminalOpen ? " editor-main__split--with-terminal" : ""}`}>
          <div className="editor-viewport">
            {joined && filesLoaded && activeFileId ? (
              <MonacoEditor
                key={editorKey}
                height="100%"
                theme={isDark ? "vs-dark" : "vs"}
                language={files[activeFileId]?.language ?? "plaintext"}
                onMount={handleEditorMount}
                options={{
                  ...monacoOptions,
                  // FIX: Enforce viewer read-only at editor level, not just socket level.
                  readOnly: userRole === "viewer",
                  domReadOnly: userRole === "viewer",
                }}
              />
            ) : joined && Object.keys(files).length === 0 ? (
              <div className="editor-empty editor-empty--card">
                <strong>No files yet</strong>
                <span>Create a file using the sidebar, upload a folder, or import from GitHub.</span>
              </div>
            ) : (
              <div className="editor-empty">
                {!joined ? "Connecting..." : "Loading files..."}
              </div>
            )}

            {editorNotification && (
              <div className="editor-notification">{editorNotification}</div>
            )}
          </div>

          {terminalOpen && (
            <div className="run-terminal-wrap">
              <Suspense
                fallback={
                  <div className="run-terminal run-terminal--lazy">
                    <div className="run-terminal__toolbar">
                      <span className="run-terminal__hint">Loading terminal...</span>
                    </div>
                    <div className="run-terminal__xterm-host run-terminal__xterm-host--placeholder" />
                  </div>
                }
              >
                <RunTerminal
                  getCode={getRunCode}
                  language={activeFile?.language}
                  fileName={activeFile?.name}
                  activeFileId={activeFileId}
                  files={files}
                  folders={folders}
                  disabled={!joined}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
