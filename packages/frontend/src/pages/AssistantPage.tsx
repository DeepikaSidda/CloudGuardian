import React, { useState, useRef, useEffect, useCallback } from "react";
import { sendAssistantMessage, listChats, getChat, saveChat, deleteChat as apiDeleteChat } from "../api-client";
import type { AssistantMessage, AssistantAttachment } from "../api-client";

interface FilePreview { type: "image" | "video" | "document"; format: string; data: string; name: string; preview?: string; }

interface ChatMsg extends AssistantMessage {
  timestamp: string;
  isLoading?: boolean;
  attachments?: FilePreview[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMsg[];
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "cloudguardian_chats";
function loadSessionsLocal(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || "[]";
    if (raw.length > 500000) { localStorage.removeItem(STORAGE_KEY); return []; }
    return JSON.parse(raw);
  } catch { localStorage.removeItem(STORAGE_KEY); return []; }
}
function saveSessions(sessions: ChatSession[]) {
  // Strip base64 data from attachments before saving — prevents localStorage overflow
  const cleaned = sessions.map(s => ({
    ...s,
    messages: s.messages.map(m => ({
      ...m,
      attachments: m.attachments?.map(a => ({ type: a.type, format: a.format, name: a.name })) as any,
    })),
  }));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned)); } catch { /* localStorage full, ignore */ }
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function getTitle(msg: string) { return msg.length > 40 ? msg.slice(0, 40) + "..." : msg; }
function groupByDate(sessions: ChatSession[]): Record<string, ChatSession[]> {
  const groups: Record<string, ChatSession[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;
  sessions.forEach(s => {
    const t = new Date(s.updatedAt).getTime();
    const key = t >= today ? "Today" : t >= yesterday ? "Yesterday" : t >= weekAgo ? "Previous 7 Days" : "Older";
    (groups[key] = groups[key] || []).push(s);
  });
  return groups;
}

const IMG_FORMATS = ["png", "jpeg", "jpg", "gif", "webp"];
const VID_FORMATS = ["mp4", "mov", "webm", "mkv"];
const DOC_FORMATS = ["pdf", "txt", "csv", "html", "md", "doc", "docx", "xls", "xlsx"];

function classifyFile(file: File): { type: "image" | "video" | "document"; format: string } | null {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const mime = file.type.toLowerCase();
  if (mime.startsWith("image/") || IMG_FORMATS.includes(ext)) return { type: "image", format: ext === "jpg" ? "jpeg" : ext };
  if (mime.startsWith("video/") || VID_FORMATS.includes(ext)) return { type: "video", format: ext };
  if (DOC_FORMATS.includes(ext) || mime === "application/pdf" || mime.startsWith("text/")) return { type: "document", format: ext };
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const result = reader.result as string; resolve(result.split(",")[1]); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AssistantPage() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessionsLocal);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<FilePreview[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savePendingRef = useRef<Set<string>>(new Set());

  const activeSession = sessions.find(s => s.id === activeId) || null;
  const messages = activeSession?.messages || [];

  // Load chats from DynamoDB on mount, migrate localStorage if needed
  useEffect(() => {
    (async () => {
      try {
        const remote = await listChats();
        if (remote.length > 0) {
          // Load full sessions from API
          const fullSessions: ChatSession[] = [];
          for (const summary of remote.slice(0, 50)) {
            try {
              const full = await getChat(summary.id);
              fullSessions.push({ id: full.id, title: full.title, messages: (full.messages || []) as ChatMsg[], createdAt: full.createdAt, updatedAt: full.updatedAt });
            } catch { fullSessions.push({ id: summary.id, title: summary.title, messages: [], createdAt: summary.createdAt, updatedAt: summary.updatedAt }); }
          }
          setSessions(fullSessions);
        } else {
          // Migrate localStorage chats to DynamoDB
          const local = loadSessionsLocal();
          if (local.length > 0) {
            setSessions(local);
            for (const s of local) {
              try {
                const cleaned = s.messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp, attachments: m.attachments?.map(a => ({ type: a.type, format: a.format, name: a.name })) }));
                await saveChat({ id: s.id, title: s.title, messages: cleaned as any, createdAt: s.createdAt, updatedAt: s.updatedAt });
              } catch { /* ignore migration errors */ }
            }
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch {
        // API failed, fall back to localStorage
        setSessions(loadSessionsLocal());
      }
      setLoadingChats(false);
    })();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Save session to DynamoDB (debounced per session)
  const persistSession = useCallback((session: ChatSession) => {
    const cleaned = session.messages.filter(m => !m.isLoading).map(m => ({
      role: m.role, content: m.content, timestamp: m.timestamp,
      attachments: m.attachments?.map(a => ({ type: a.type, format: a.format, name: a.name })),
    }));
    saveChat({ id: session.id, title: session.title, messages: cleaned as any, createdAt: session.createdAt, updatedAt: session.updatedAt }).catch(() => {});
  }, []);

  const updateSession = useCallback((id: string, msgs: ChatMsg[], title?: string) => {
    setSessions(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, messages: msgs, updatedAt: new Date().toISOString(), ...(title ? { title } : {}) } : s);
      const session = updated.find(s => s.id === id);
      if (session && !msgs.some(m => m.isLoading)) persistSession(session);
      return updated;
    });
  }, [persistSession]);

  const newChat = useCallback(() => {
    const s: ChatSession = { id: genId(), title: "New Chat", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
    setInput("");
    setPendingFiles([]);
    saveChat({ id: s.id, title: s.title, messages: [], createdAt: s.createdAt, updatedAt: s.updatedAt }).catch(() => {});
  }, []);

  const deleteChatHandler = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeId === id) setActiveId(null);
    apiDeleteChat(id).catch(() => {});
  }, [activeId]);

  // File handling
  const processFiles = async (files: FileList | File[]) => {
    const newFiles: FilePreview[] = [];
    for (const file of Array.from(files)) {
      const maxSize = 4.5 * 1024 * 1024; // ~4.5MB raw → ~6MB base64, safe under API Gateway 10MB limit
      if (file.size > maxSize) { alert(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB — max is 4.5MB. For videos, try a shorter clip or compress it first.`); continue; }
      const cls = classifyFile(file);
      if (!cls) { alert(`${file.name}: unsupported file type`); continue; }
      const data = await fileToBase64(file);
      let preview: string | undefined;
      if (cls.type === "image") preview = `data:${file.type};base64,${data}`;
      else if (cls.type === "video") preview = URL.createObjectURL(file);
      newFiles.push({ ...cls, data, name: file.name, preview });
    }
    setPendingFiles(prev => [...prev, ...newFiles]);
  };

  const removePendingFile = (idx: number) => setPendingFiles(prev => prev.filter((_, i) => i !== idx));

  // Speech
  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported. Use Chrome."); return; }
    const recognition = new SR();
    recognition.continuous = false; recognition.interimResults = true; recognition.lang = "en-US";
    recognitionRef.current = recognition;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (e: any) => { setInput(Array.from(e.results).map((r: any) => r[0].transcript).join("")); };
    recognition.onend = () => { setListening(false); if (inputRef.current?.value) handleSend(inputRef.current.value); };
    recognition.onerror = () => setListening(false);
    recognition.start();
  };
  const stopListening = () => { recognitionRef.current?.stop(); setListening(false); };
  const speakText = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*#`_~]/g, "").replace(/\n+/g, ". "));
    utterance.rate = 1.05; utterance.pitch = 1;
    utterance.onstart = () => setSpeaking(true); utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };
  const stopSpeaking = () => { window.speechSynthesis?.cancel(); setSpeaking(false); };

  const handleSend = async (text?: string) => {
    const msg = (text ?? input).trim();
    const hasFiles = pendingFiles.length > 0;
    if ((!msg && !hasFiles) || loading) return;
    setInput("");
    const filesToSend = [...pendingFiles];
    setPendingFiles([]);

    let sid = activeId;
    if (!sid) {
      const title = msg ? getTitle(msg) : (filesToSend[0]?.name || "File upload");
      const s: ChatSession = { id: genId(), title, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      setSessions(prev => [s, ...prev]);
      sid = s.id;
      setActiveId(s.id);
    }

    const ts = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
    const displayContent = msg || `Uploaded ${filesToSend.length} file(s)`;
    const userMsg: ChatMsg = { role: "user", content: displayContent, timestamp: ts, attachments: filesToSend.length > 0 ? filesToSend : undefined };
    const loadingMsg: ChatMsg = { role: "assistant", content: "", timestamp: "", isLoading: true };

    const currentMsgs = sessions.find(s => s.id === sid)?.messages || [];
    const isFirst = currentMsgs.length === 0;
    updateSession(sid, [...currentMsgs, userMsg, loadingMsg], isFirst ? getTitle(displayContent) : undefined);
    setLoading(true);

    try {
      const history: AssistantMessage[] = currentMsgs.filter(m => !m.isLoading).map(m => ({ role: m.role, content: m.content }));
      const attachments: AssistantAttachment[] = filesToSend.map(f => ({ type: f.type, format: f.format, data: f.data, name: f.name }));
      const res = await sendAssistantMessage(msg || "Please analyze the uploaded file(s) and describe what you see.", history, attachments);
      const cleanReply = res.reply.replace(/\*\*/g, "").replace(/`/g, "").replace(/#{1,6}\s?/g, "");
      const botMsg: ChatMsg = { role: "assistant", content: cleanReply, timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) };
      updateSession(sid, [...currentMsgs, userMsg, botMsg]);
      speakText(cleanReply);
    } catch (err: any) {
      const errMsg: ChatMsg = { role: "assistant", content: `Sorry, something went wrong: ${err.message}`, timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) };
      updateSession(sid, [...currentMsgs, userMsg, errMsg]);
    } finally { setLoading(false); }
  };

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files); };

  const suggestions = [
    "\uD83D\uDCE6 How many S3 buckets do I have?",
    "\uD83D\uDDA5\uFE0F List my EC2 instances",
    "\uD83D\uDD0D What are my latest scan findings?",
    "\u2601\uFE0F Create an S3 bucket",
    "\uD83D\uDCC8 Show my Lambda functions",
    "\uD83D\uDEE1\uFE0F List my security groups",
  ];

  const grouped = groupByDate(sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  const groupOrder = ["Today", "Yesterday", "Previous 7 Days", "Older"];

  const fileIcon = (type: string) => type === "image" ? "\uD83D\uDDBC\uFE0F" : type === "video" ? "\uD83C\uDFA5" : "\uD83D\uDCC4";

  return (
    <div className="page-enter" style={{ display: "flex", height: "calc(100vh - 80px)", maxHeight: "calc(100vh - 80px)", gap: 0 }}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragOver && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(99,102,241,0.15)", border: "3px dashed #6366f1", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#a5b4fc" }}>Drop files here to upload</div>
        </div>
      )}
      <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.pdf,.txt,.csv,.html,.md,.doc,.docx,.xls,.xlsx"
        style={{ display: "none" }} onChange={e => { if (e.target.files) processFiles(e.target.files); e.target.value = ""; }} />

      {/* Sidebar */}
      <div style={{
        width: sidebarOpen ? 260 : 0, minWidth: sidebarOpen ? 260 : 0, overflow: "hidden",
        transition: "all 0.3s ease", borderRight: sidebarOpen ? "1px solid var(--border)" : "none",
        display: "flex", flexDirection: "column", background: "rgba(0,0,0,0.15)",
      }}>
        <div style={{ padding: "12px 12px 8px", flexShrink: 0 }}>
          <button onClick={newChat} className="assistant-new-chat-btn" style={{
            width: "100%", padding: "10px 14px", background: "linear-gradient(135deg, #3b82f6, #6366f1)",
            border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
          }}>
            <span style={{ fontSize: 16 }}>+</span> New Chat
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 12px" }}>
          {groupOrder.map(group => {
            const items = grouped[group];
            if (!items?.length) return null;
            return (
              <div key={group}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", padding: "10px 8px 4px" }}>{group}</div>
                {items.map((s, idx) => (
                  <div key={s.id} onClick={() => setActiveId(s.id)} className="assistant-sidebar-item" style={{
                    padding: "9px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
                    background: s.id === activeId ? "rgba(99,102,241,0.15)" : "transparent",
                    border: s.id === activeId ? "1px solid rgba(99,102,241,0.25)" : "1px solid transparent",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.15s",
                    animationDelay: `${idx * 0.05}s`,
                  }}>
                    <div style={{ fontSize: 12, color: s.id === activeId ? "var(--text-primary)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{s.title}</div>
                    <button onClick={e => { e.stopPropagation(); deleteChatHandler(s.id); }}
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4, opacity: 0.5, flexShrink: 0 }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = "1")} onMouseLeave={e => (e.currentTarget.style.opacity = "0.5")}>×</button>
                  </div>
                ))}
              </div>
            );
          })}
          {sessions.length === 0 && <div style={{ textAlign: "center", padding: "32px 12px", color: "var(--text-muted)", fontSize: 12 }}>{loadingChats ? "Loading chats..." : "No conversations yet. Start a new chat!"}</div>}
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setSidebarOpen(p => !p)} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer", padding: "6px 8px", fontSize: 16, display: "flex", alignItems: "center" }}>
              {"\u2630"}
            </button>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 2 }}>
                <span style={{ marginRight: 8 }}>{"\uD83E\uDD16"}</span>CloudGuardian Assistant
              </h1>
              <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Ask anything, upload images/docs/videos, or use your voice</p>
            </div>
          </div>
          {speaking && (
            <button onClick={stopSpeaking} style={{ padding: "6px 14px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              {"\uD83D\uDD07"} Stop
            </button>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px", marginBottom: 12 }}>
          {messages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20 }}>
              <div className="assistant-bot-avatar" style={{ opacity: 0.7 }}>{"\uD83E\uDD16"}</div>
              <div style={{ textAlign: "center" }}>
                <div className="assistant-title-gradient" style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Hi! I'm your CloudGuardian Assistant</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 380 }}>I can help you manage your AWS account. Upload images, documents, or videos for analysis. Ask me anything!</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 480 }}>
                {suggestions.map((s, i) => (
                  <button key={i} className="assistant-suggestion-btn" onClick={() => { const t = s.replace(/^[\uD83C-\uDBFF\uDC00-\uDFFF\u2600-\u27FF\uFE0F]+ /, ""); setInput(t); handleSend(t); }}
                    style={{ padding: "7px 13px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 20, color: "var(--text-secondary)", fontSize: 11, cursor: "pointer", transition: "all 0.2s" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((msg, i) => (
                <div key={i} className="assistant-msg-bubble" style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "75%", padding: "10px 14px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.role === "user" ? "linear-gradient(135deg, #3b82f6, #6366f1)" : "rgba(255,255,255,0.05)",
                    border: msg.role === "user" ? "none" : "1px solid var(--border)",
                    boxShadow: msg.role === "assistant" && !msg.isLoading ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
                  }}>
                    {msg.isLoading ? (
                      <div style={{ display: "flex", gap: 5, padding: "4px 0", alignItems: "center" }}>
                        {[0, 1, 2].map(j => (<div key={j} className="assistant-typing-dot" />))}
                      </div>
                    ) : (
                      <>
                        {/* Attachment previews */}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                            {msg.attachments.map((att, ai) => (
                              <div key={ai} style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
                                {att.type === "image" && att.preview && <img src={att.preview} alt={att.name} style={{ maxWidth: 200, maxHeight: 150, display: "block", borderRadius: 6 }} />}
                                {att.type === "video" && att.preview && <video src={att.preview} style={{ maxWidth: 200, maxHeight: 150, display: "block", borderRadius: 6 }} controls />}
                                {att.type === "document" && (
                                  <div style={{ padding: "8px 12px", background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.8)" }}>
                                    {fileIcon(att.type)} {att.name}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: msg.role === "user" ? "#fff" : "var(--text-primary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{msg.content}</div>
                        <div style={{ fontSize: 10, color: msg.role === "user" ? "rgba(255,255,255,0.6)" : "var(--text-muted)", marginTop: 3, textAlign: msg.role === "user" ? "right" : "left" }}>{msg.timestamp}</div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Pending files preview */}
        {pendingFiles.length > 0 && (
          <div style={{ flexShrink: 0, display: "flex", gap: 8, padding: "8px 16px", overflowX: "auto" }}>
            {pendingFiles.map((f, i) => (
              <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)", flexShrink: 0 }}>
                {f.type === "image" && f.preview && <img src={f.preview} alt={f.name} style={{ width: 80, height: 60, objectFit: "cover", display: "block" }} />}
                {f.type === "video" && <div style={{ width: 80, height: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.3)", fontSize: 24 }}>{"\uD83C\uDFA5"}</div>}
                {f.type === "document" && <div style={{ width: 80, height: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)", fontSize: 20 }}>{"\uD83D\uDCC4"}</div>}
                <div style={{ fontSize: 9, padding: "2px 4px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>{f.name}</div>
                <button onClick={() => removePendingFile(i)} style={{
                  position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%",
                  background: "rgba(0,0,0,0.7)", border: "none", color: "#fff", fontSize: 11,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="assistant-input-bar" style={{ flexShrink: 0, display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", margin: "0 16px 8px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", borderRadius: 14 }}>
          <button onClick={listening ? stopListening : startListening}
            style={{
              width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, transition: "all 0.3s",
              background: listening ? "linear-gradient(135deg, #ef4444, #dc2626)" : "linear-gradient(135deg, #3b82f6, #6366f1)",
              boxShadow: listening ? "0 0 20px rgba(239,68,68,0.4)" : "none",
              animation: listening ? "pulse 1.5s ease-in-out infinite" : "none",
            }}>
            {listening ? "\uD83D\uDD34" : "\uD83C\uDF99\uFE0F"}
          </button>
          <button onClick={() => fileInputRef.current?.click()} title="Upload files"
            style={{
              width: 40, height: 40, borderRadius: "50%", border: "1px solid var(--border)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0,
              background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", transition: "all 0.2s",
            }}>
            {"\uD83D\uDCCE"}
          </button>
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder={listening ? "Listening..." : pendingFiles.length > 0 ? "Add a message about your files..." : "Ask me anything about your AWS account..."}
            style={{ flex: 1, padding: "10px 14px", fontSize: 13, background: "transparent", border: "none", color: "var(--text-primary)", outline: "none" }} />
          <button onClick={() => handleSend()} disabled={loading || (!input.trim() && pendingFiles.length === 0)}
            style={{
              width: 40, height: 40, borderRadius: "50%", border: "none",
              cursor: loading || (!input.trim() && pendingFiles.length === 0) ? "default" : "pointer",
              background: loading || (!input.trim() && pendingFiles.length === 0) ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #3b82f6, #6366f1)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0, transition: "all 0.2s",
              opacity: loading || (!input.trim() && pendingFiles.length === 0) ? 0.4 : 1,
            }}>
            {loading ? <span className="spinner" /> : "\u27A4"}
          </button>
        </div>
      </div>
    </div>
  );
}
