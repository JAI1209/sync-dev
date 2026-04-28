import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EditorHeader from "./EditorHeader.jsx";
import EditorWorkspace from "./EditorWorkspace.jsx";
import ParticipantsPanel from "./ParticipantsPanel.jsx";

vi.mock("@monaco-editor/react", () => ({
  default: ({ options }) => (
    <div
      data-testid="monaco"
      data-readonly={String(Boolean(options?.readOnly))}
      data-dom-readonly={String(Boolean(options?.domReadOnly))}
    />
  ),
}));

const permissions = {
  canEditFiles: true,
  canManageRoom: true,
  canManageRoles: true,
  canPushGitHub: true,
  canInvite: true,
};

describe("EditorHeader buttons", () => {
  it("copy room ID button calls the provided room copy handler", () => {
    const handleCopyRoom = vi.fn();
    render(
      <EditorHeader
        roomId="ABCD2345"
        copied={false}
        handleCopyRoom={handleCopyRoom}
        userRole="owner"
        permissions={permissions}
        handleImportGithub={vi.fn()}
        handleDownloadZip={vi.fn()}
        handleCommitPush={vi.fn()}
        setCommitBranch={vi.fn()}
        setCommitMessage={vi.fn()}
        setTerminalOpen={vi.fn()}
        socketStatus="connected"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ABCD2345/i }));
    expect(handleCopyRoom).toHaveBeenCalledTimes(1);
  });

  it("share invite link copies the full editor URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <EditorHeader
        roomId="ABCD2345"
        copied={false}
        handleCopyRoom={vi.fn()}
        userRole="owner"
        permissions={permissions}
        handleImportGithub={vi.fn()}
        handleDownloadZip={vi.fn()}
        handleCommitPush={vi.fn()}
        setCommitBranch={vi.fn()}
        setCommitMessage={vi.fn()}
        setTerminalOpen={vi.fn()}
        socketStatus="connected"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /share invite/i }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/editor/ABCD2345`);
  });

  it("inline GitHub import form submits repo URL and optional ref", () => {
    const handleImportGithub = vi.fn();
    render(
      <EditorHeader
        roomId="ABCD2345"
        copied={false}
        handleCopyRoom={vi.fn()}
        userRole="editor"
        permissions={{ ...permissions, canPushGitHub: false, canInvite: false }}
        handleImportGithub={handleImportGithub}
        handleDownloadZip={vi.fn()}
        handleCommitPush={vi.fn()}
        setCommitBranch={vi.fn()}
        setCommitMessage={vi.fn()}
        setTerminalOpen={vi.fn()}
        socketStatus="connected"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /import/i }));
    fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo"), {
      target: { value: "https://github.com/openai/syncdev" },
    });
    fireEvent.change(screen.getByPlaceholderText("branch/ref optional"), {
      target: { value: "develop" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import repo/i }));

    expect(handleImportGithub).toHaveBeenCalledWith("https://github.com/openai/syncdev", "develop");
  });
});

describe("EditorWorkspace RBAC and empty states", () => {
  function renderWorkspace(overrides = {}) {
    return render(
      <EditorWorkspace
        sidebarOpen
        files={{ file1: { id: "file1", name: "main.js", language: "javascript", content: "" } }}
        folders={{}}
        activeFileId="file1"
        openTabs={["file1"]}
        openFile={vi.fn()}
        closeTab={vi.fn()}
        handleCreateFile={vi.fn()}
        handleCreateFolder={vi.fn()}
        handleRenameFile={vi.fn()}
        handleRenameFolder={vi.fn()}
        handleDeleteFile={vi.fn()}
        handleDeleteFolder={vi.fn()}
        userRole="viewer"
        permissions={{ ...permissions, canEditFiles: false }}
        uploadInputRef={{ current: null }}
        uploadStatus={null}
        handleUpload={vi.fn()}
        roomId="ABCD2345"
        joined
        filesLoaded
        editorKey={0}
        handleEditorMount={vi.fn()}
        monacoOptions={{}}
        terminalOpen={false}
        getRunCode={vi.fn()}
        activeFile={{ id: "file1", language: "javascript", name: "main.js" }}
        editorNotification={null}
        {...overrides}
      />,
    );
  }

  it("Monaco editor readOnly option is true when userRole is viewer", () => {
    renderWorkspace();
    expect(screen.getByTestId("monaco")).toHaveAttribute("data-readonly", "true");
    expect(screen.getByTestId("monaco")).toHaveAttribute("data-dom-readonly", "true");
  });

  it("shows graceful empty state when joined room has no files", () => {
    renderWorkspace({ files: {}, activeFileId: null, openTabs: [], filesLoaded: false });
    expect(screen.getByText("No files yet")).toBeInTheDocument();
    expect(screen.getByText(/Create a file using the sidebar/i)).toBeInTheDocument();
  });
});

describe("ParticipantsPanel", () => {
  it("participant cards show correct role badge per user", () => {
    render(
      <ParticipantsPanel
        users={[
          { id: "1", username: "alice", role: "owner" },
          { id: "2", username: "bob", role: "viewer" },
        ]}
        username="alice"
        showAll
        setShowAll={vi.fn()}
        hoveredUser={null}
        setHoveredUser={vi.fn()}
        mutedPeers={new Set()}
        setMutedPeers={vi.fn()}
        camOn={false}
        remoteStreams={{}}
        showVideo={false}
        localVideoRef={{ current: null }}
        remoteVideoRefs={{ current: {} }}
      />,
    );

    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("viewer")).toBeInTheDocument();
  });
});
