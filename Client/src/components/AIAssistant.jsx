import { useState, useCallback } from "react";
import { getAccessToken } from "../api/client";

export default function AIAssistant({ editorRef, activeFileId }) {
  const [prompt, setPrompt] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(null);

  const askAI = useCallback(async () => {
    if (!editorRef.current || !activeFileId) return;
    
    const editor = editorRef.current;
    const selection = editor.getSelection();
    const model = editor.getModel();
    
    // Get selected text or full file
    const selectedText = selection.isEmpty() 
      ? model.getValue() 
      : model.getValueInRange(selection);
    
    const language = model.getLanguageId();
    
    setLoading(true);
    setError("");
    
    try {
      const token = getAccessToken();
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: selectedText,
          language,
          prompt: prompt || "Suggest improvements",
        }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.msg || "AI request failed");
      }
      
      setSuggestion(data.suggestion);
      setRemaining(data.remainingRequests);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [editorRef, activeFileId, prompt]);

  const applySuggestion = useCallback(() => {
    if (!editorRef.current || !suggestion) return;
    
    const editor = editorRef.current;
    const selection = editor.getSelection();
    
    // Replace selected text or insert at cursor
    editor.executeEdits("ai-assistant", [{
      range: selection.isEmpty() 
        ? editor.getPosition()
        : selection,
      text: suggestion,
    }]);
    
    setSuggestion("");
  }, [editorRef, suggestion]);

  return (
    <div className="ai-assistant">
      <h3>🤖 AI Assistant</h3>
      
      <div className="ai-controls">
        <textarea
          placeholder="Ask AI about this code... (e.g., 'Optimize', 'Explain', 'Add comments')"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
        />
        
        <button 
          onClick={askAI} 
          disabled={loading}
          className="ai-btn ask"
        >
          {loading ? "Thinking..." : "Ask AI"}
        </button>
      </div>
      
      {remaining !== null && (
        <div className="ai-rate-limit">
          {remaining} requests remaining this hour
        </div>
      )}
      
      {error && (
        <div className="ai-error">
          ⚠️ {error}
        </div>
      )}
      
      {suggestion && (
        <div className="ai-suggestion">
          <h4>Suggestion:</h4>
          <pre>{suggestion}</pre>
          <div className="ai-actions">
            <button onClick={applySuggestion} className="ai-btn apply">
              ✓ Apply to editor
            </button>
            <button onClick={() => setSuggestion("")} className="ai-btn reject">
              ✗ Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
