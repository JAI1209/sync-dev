import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importGitHubRepo } from "../api/github";
import { getImportRetryDelay, parseGithubRepoInput, useGitHub } from "./useGitHub";

vi.mock("../api/github", () => ({
  commitGitHubRepo: vi.fn(),
  importGitHubRepo: vi.fn(),
}));

function createSocket() {
  const listeners = {};
  return {
    connected: true,
    emit: vi.fn(),
    once: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    off: vi.fn(),
    listeners,
  };
}

describe("useGitHub import flow", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("handleImportGithub with invalid URL sets githubHint error without alert", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const socketRef = { current: createSocket() };
    const { result } = renderHook(() =>
      useGitHub({
        files: {},
        folders: {},
        roomId: "ABCD2345",
        socketRef,
        joined: true,
        loadFiles: vi.fn(),
        activeFileId: null,
      }),
    );

    await act(async () => {
      await result.current.handleImportGithub("not-a-url");
    });

    expect(result.current.githubHint).toBe("Invalid GitHub repo URL.");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("parseGithubRepoInput accepts owner slash repo and full github URLs", () => {
    expect(parseGithubRepoInput("shivanshsingh05102000/dashboardFinance")).toEqual({
      owner: "shivanshsingh05102000",
      repo: "dashboardFinance",
      refFromUrl: "",
    });

    expect(parseGithubRepoInput("https://github.com/shivanshsingh05102000/dashboardFinance")).toEqual({
      owner: "shivanshsingh05102000",
      repo: "dashboardFinance",
      refFromUrl: "",
    });
  });

  it("handleImportGithub extracts tree ref from a github URL when no explicit branch is provided", async () => {
    importGitHubRepo.mockResolvedValue({
      files: {},
      folders: {},
      orderedFileIds: [],
      meta: { owner: "shivanshsingh05102000", repo: "dashboardFinance", defaultBranch: "main" },
    });

    const socketRef = { current: createSocket() };
    const { result } = renderHook(() =>
      useGitHub({
        files: {},
        folders: {},
        roomId: "ABCD2345",
        socketRef,
        joined: true,
        loadFiles: vi.fn(),
        activeFileId: null,
      }),
    );

    await act(async () => {
      await result.current.handleImportGithub(
        "https://github.com/shivanshsingh05102000/dashboardFinance/tree/main",
      );
    });

    expect(importGitHubRepo).toHaveBeenCalledWith(
      "shivanshsingh05102000",
      "dashboardFinance",
      "main",
    );
  });

  it("files do not appear in local state before import-complete is received", async () => {
    const socket = createSocket();
    const socketRef = { current: socket };
    const loadFiles = vi.fn();
    sessionStorage.setItem(
      "syncdev_pending_import",
      JSON.stringify({
        roomId: "ABCD2345",
        files: { f1: { id: "f1", name: "index.js", content: "" } },
        folders: {},
        orderedFileIds: ["f1"],
        github: { repoPath: "owner/repo" },
      }),
    );

    const { unmount } = renderHook(() =>
      useGitHub({
        files: {},
        folders: {},
        roomId: "ABCD2345",
        socketRef,
        joined: true,
        loadFiles,
        activeFileId: null,
      }),
    );

    await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledWith("bulk-import", expect.any(Object));
    expect(loadFiles).not.toHaveBeenCalled();

    act(() => {
      socket.listeners["import-complete"]({ filesImported: 1, foldersImported: 0 });
    });

    expect(loadFiles).toHaveBeenCalledWith(
      { f1: { id: "f1", name: "index.js", content: "" } },
      {},
      "f1",
    );
    unmount();
  });

  it("duplicate bulk-import emission is blocked by the mounting lock ref", async () => {
    const socket = createSocket();
    const socketRef = { current: socket };
    sessionStorage.setItem(
      "syncdev_pending_import",
      JSON.stringify({
        roomId: "ABCD2345",
        files: { f1: { id: "f1", name: "index.js", content: "" } },
        folders: {},
      }),
    );

    const { rerender, unmount } = renderHook(({ tick }) =>
      useGitHub({
        files: {},
        folders: {},
        roomId: "ABCD2345",
        socketRef,
        joined: true,
        loadFiles: vi.fn(),
        activeFileId: tick,
      }),
      { initialProps: { tick: "a" } },
    );

    await Promise.resolve();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    rerender({ tick: "b" });
    expect(socket.emit).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("retry delay follows exponential backoff", () => {
    expect(getImportRetryDelay(0)).toBe(500);
    expect(getImportRetryDelay(1)).toBe(1000);
    expect(getImportRetryDelay(2)).toBe(2000);
    expect(getImportRetryDelay(10)).toBe(8000);
  });
});
