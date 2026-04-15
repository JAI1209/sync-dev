import { lazy, Suspense } from "react";
import MonacoEditor from "@monaco-editor/react";
import FileTree from "../components/FileTree";
import MemberManager from "../components/MemberManager";
import TabBar from "../components/TabBar";

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
}) {
  return (
    <div className="editor-workspace">
      {/* sidebar */}
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
          />
          <div className="sidebar-upload">
            <input
              ref={uploadInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              style={{ display: "none" }}
              onChange={handleUpload}
            />
            <button
              className="sidebar-upload-btn"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploadStatus === "loading" || userRole === "viewer"}
            >
              {uploadStatus === "loading" ? "⏳ Uploading…" : userRole === "viewer" ? "⬆ View Only" : "⬆ Upload Folder"}
            </button>
          </div>
          <MemberManager roomId={roomId} userRole={userRole} />
        </aside>
      )}

      {/* editor area */}
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
                theme="vs-dark"
                language={files[activeFileId]?.language ?? "plaintext"}
                onMount={handleEditorMount}
                options={monacoOptions}
              />
            ) : (
              <div className="editor-empty">
                {!joined ? "Connecting…" : "Loading files…"}
              </div>
            )}
            {editorNotification && (
              <div className="editor-notification">{editorNotification}</div>
            )}
          </div>
          {terminalOpen && (
            <div className="run-terminal-wrap">
              <Suspense fallback={
                <div className="run-terminal run-terminal--lazy">
                  <div className="run-terminal__toolbar">
                    <span className="run-terminal__hint">Loading terminal…</span>
                  </div>
                  <div className="run-terminal__xterm-host run-terminal__xterm-host--placeholder" />
                </div>
              }>
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
