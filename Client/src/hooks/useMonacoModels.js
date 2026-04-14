import { useEffect, useRef, useCallback } from "react";

const DEBOUNCE_MS = 80;

export function useMonacoModels({ files, joined, activeFileId, monaco, socketRef, pendingRemoteUpdates, roomId }) {
  const modelsRef = useRef({});
  const uriToFileIdRef = useRef({});
  const editorRef = useRef(null);
  const mountedRef = useRef(false);
  const debounceTimer = useRef(null);

  // Model helpers
  const getOrCreateModel = useCallback((fileId) => {
    if (!monaco) return null;

    const file = files[fileId];
    if (!file) return null;

    const uri = monaco.Uri.parse(`syncdev://files/${fileId}`);

    // Check if Monaco already has this model registered
    let model = monaco.editor.getModel(uri);
    
    if (model && !model.isDisposed()) {
      // Model exists - update content from current files state
      model.setValue(file.content || "");
      if (file.language) {
        monaco.editor.setModelLanguage(model, file.language);
      }
      modelsRef.current[fileId] = model;
      uriToFileIdRef.current[uri.toString()] = fileId;
      return model;
    }

    // Create new model with file content
    model = monaco.editor.createModel(
      file.content || "",
      file.language || "plaintext",
      uri
    );
    modelsRef.current[fileId] = model;
    uriToFileIdRef.current[uri.toString()] = fileId;
    return model;
  }, [monaco, files]);

  // Sync editor model when activeFileId changes
  useEffect(() => {
    if (!editorRef.current || !monaco || !activeFileId || !mountedRef.current) return;
    if (editorRef.current._isDisposed) return;

    const model = getOrCreateModel(activeFileId);
    if (!model) return;

    try {
      if (editorRef.current.getModel() !== model) {
        editorRef.current.setModel(model);
        editorRef.current.updateOptions({ readOnly: files[activeFileId]?.readOnly || false });
      }
    } catch (e) {
      if (!e.message?.includes("disposed")) {
        console.warn("[Editor] setModel error:", e.message);
      }
    }
  }, [activeFileId, monaco, files, getOrCreateModel]);

  // Create models for all files once Monaco + room are ready
  useEffect(() => {
    if (!monaco || !joined) return;
    Object.keys(files).forEach((id) => getOrCreateModel(id));
  }, [monaco, joined, files, getOrCreateModel]);

  // Dispose models for deleted files
  useEffect(() => {
    if (!monaco) return;
    const currentIds = new Set(Object.keys(files));
    Object.entries(modelsRef.current).forEach(([id, model]) => {
      if (!currentIds.has(id)) {
        const uriKey = model?.uri?.toString?.();
        if (uriKey) delete uriToFileIdRef.current[uriKey];
        if (!model.isDisposed()) model.dispose();
        delete modelsRef.current[id];
      }
    });
  }, [files, monaco]);

  // Cleanup all models on unmount
  useEffect(() => {
    return () => {
      Object.values(modelsRef.current).forEach((m) => {
        if (!m.isDisposed()) m.dispose();
      });
      modelsRef.current = {};
      uriToFileIdRef.current = {};
      mountedRef.current = false;
    };
  }, []);

  const handleEditorMount = (editor) => {
    editorRef.current = editor;
    mountedRef.current = true;

    if (monaco && activeFileId) {
      const model = getOrCreateModel(activeFileId);
      if (model) {
        try {
          editor.setModel(model);
          editor.updateOptions({ readOnly: files[activeFileId]?.readOnly || false });
        } catch (e) {
          console.warn("[Editor] Initial setModel error:", e.message);
        }
      }
    }

    // Setup change handler - emits file-change via socket
    const disposable = editor.onDidChangeModelContent(() => {
      const model = editor.getModel();
      if (!model) return;

      // O(1) URI lookup avoids scanning all models on every keystroke.
      const fileId = uriToFileIdRef.current[model.uri.toString()];

      if (!fileId) return;

      // Bug 4: Skip emit if this was a remote update (prevent echo loop)
      if (pendingRemoteUpdates?.current?.has(fileId)) return;

      const content = model.getValue();

      // Debounce socket emit
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

    return () => disposable.dispose();
  };

  return {
    modelsRef,
    editorRef,
    mountedRef,
    getOrCreateModel,
    handleEditorMount,
  };
}
