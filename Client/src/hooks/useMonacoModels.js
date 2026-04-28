import { useEffect, useRef, useCallback } from "react";

const DEBOUNCE_MS = 80;

export function useMonacoModels({
  files,
  joined,
  activeFileId,
  monaco,
  socketRef,
  pendingRemoteUpdates,
  roomId,
  updateFileContent,
}) {
  const modelsRef = useRef({});
  const uriToFileIdRef = useRef({});
  const editorRef = useRef(null);
  const mountedRef = useRef(false);
  const debounceTimer = useRef(null);
  const changeDisposableRef = useRef(null);

  const getOrCreateModel = useCallback((fileId) => {
    if (!monaco) return null;

    const file = files[fileId];
    if (!file) return null;

    const uri = monaco.Uri.parse(`syncdev://files/${fileId}`);
    let model = monaco.editor.getModel(uri);

    if (model && !model.isDisposed()) {
      if (file.language) {
        monaco.editor.setModelLanguage(model, file.language);
      }
      modelsRef.current[fileId] = model;
      uriToFileIdRef.current[uri.toString()] = fileId;
      return model;
    }

    model = monaco.editor.createModel(
      file.content || "",
      file.language || "plaintext",
      uri
    );
    modelsRef.current[fileId] = model;
    uriToFileIdRef.current[uri.toString()] = fileId;
    return model;
  }, [monaco, files]);

  useEffect(() => {
    if (!editorRef.current || !monaco || !activeFileId || !mountedRef.current) return;
    if (editorRef.current._isDisposed) return;

    const model = getOrCreateModel(activeFileId);
    if (!model) return;

    try {
      if (editorRef.current.getModel() !== model) {
        editorRef.current.setModel(model);
      }
      editorRef.current.updateOptions({ readOnly: files[activeFileId]?.readOnly || false });
    } catch (error) {
      if (!error.message?.includes("disposed")) {
        console.warn("[Editor] setModel error:", error.message);
      }
    }
  }, [activeFileId, monaco, files, getOrCreateModel]);

  useEffect(() => {
    if (!monaco || !joined) return;
    Object.keys(files).forEach((id) => getOrCreateModel(id));
  }, [monaco, joined, files, getOrCreateModel]);

  // Keep existing Monaco models synced with file store updates.
  useEffect(() => {
    if (!monaco || !joined) return;

    Object.entries(files).forEach(([id, file]) => {
      const model = modelsRef.current[id] || getOrCreateModel(id);
      if (!model || model.isDisposed()) return;

      const nextContent = file?.content || "";
      if (model.getValue() !== nextContent) {
        model.setValue(nextContent);
      }

      if (file?.language) {
        monaco.editor.setModelLanguage(model, file.language);
      }
    });
  }, [files, joined, monaco, getOrCreateModel]);

  useEffect(() => {
    if (!monaco) return;
    const currentIds = new Set(Object.keys(files));

    Object.entries(modelsRef.current).forEach(([id, model]) => {
      if (currentIds.has(id)) return;

      const uriKey = model?.uri?.toString?.();
      if (uriKey) delete uriToFileIdRef.current[uriKey];
      if (!model.isDisposed()) model.dispose();
      delete modelsRef.current[id];
    });
  }, [files, monaco]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      if (changeDisposableRef.current) {
        changeDisposableRef.current.dispose();
        changeDisposableRef.current = null;
      }
      Object.values(modelsRef.current).forEach((model) => {
        if (!model.isDisposed()) model.dispose();
      });
      modelsRef.current = {};
      uriToFileIdRef.current = {};
      mountedRef.current = false;
    };
  }, []);

  const handleEditorMount = (editor) => {
    editorRef.current = editor;
    mountedRef.current = true;

    if (changeDisposableRef.current) {
      changeDisposableRef.current.dispose();
      changeDisposableRef.current = null;
    }

    if (monaco && activeFileId) {
      const model = getOrCreateModel(activeFileId);
      if (model) {
        try {
          editor.setModel(model);
          editor.updateOptions({ readOnly: files[activeFileId]?.readOnly || false });
        } catch (error) {
          console.warn("[Editor] Initial setModel error:", error.message);
        }
      }
    }

    changeDisposableRef.current = editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;

      const fileId = uriToFileIdRef.current[model.uri.toString()];
      if (!fileId) return;

      const content = model.getValue();
      updateFileContent?.(fileId, content);

      if (pendingRemoteUpdates?.current?.has(fileId)) {
        return;
      }

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        const socket = socketRef?.current;
        if (socket?.connected && roomId) {
          socket.emit("file-change", {
            roomId,
            fileId,
            content,
          });
        }
      }, DEBOUNCE_MS);
    });
  };

  return {
    modelsRef,
    editorRef,
    mountedRef,
    getOrCreateModel,
    handleEditorMount,
  };
}
