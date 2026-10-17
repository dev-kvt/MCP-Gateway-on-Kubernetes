import { useState, useRef, useEffect } from 'react';
import { sendChatMessage } from '../api';
import { getCurrentUser, isLoggedIn } from '../api';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: any[];
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [expandedTool, setExpandedTool] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const user = getCurrentUser();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Check if the chat agent / LLM is configured ──────────────────
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data: any) => {
        // Treat absence of upstreams/errors as "check the chat endpoint instead"
        setLlmConfigured(true);
      })
      .catch(() => setLlmConfigured(false));
  }, []);

  const clearChat = () => {
    setMessages([]);
    setHistory([]);
    setExpandedTool(null);
  };

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: 'user', content: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setExpandedTool(null);

    try {
      const data = await sendChatMessage(msg, history);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply, toolCalls: data.toolCalls },
      ]);
      setHistory(data.history || []);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `⚠️ Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatToolArgs = (args: any) => {
    try {
      return typeof args === 'string' ? args : JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  };

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Chat Agent</h2>
          <p>Ask questions about your store, orders, customers, and inventory using AI-powered tools through the gateway.</p>
        </div>
        <div className="btn-group" style={{ gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={clearChat}
            disabled={messages.length === 0}
            title="Start a new conversation"
          >
            🔄 New conversation
          </button>
          {isLoggedIn() && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => (window.location.href = '/servers')}
              title="Manage upstream MCP servers"
            >
                            ⚙ Manage servers
          </button>
          )}
        </div>
      </div>

      {llmConfigured === false && (
        <div className="error-msg">
          ⚠️ The chat agent LLM is not configured on this gateway. Set
          <code>chat.llmApiKey</code> in Helm values and redeploy to enable AI-powered
          tool calling.
        </div>
      )}

      <div className="chat-container">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">💬</div>
              <p>Start a conversation.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                {[
                  'What products do we have?',
                  "Show me today's orders",
                  'Check stock for HOODIE-BLK-M',
                  'Search for VIP customers',
                  'Create a product called Test Widget priced 19.99',
                ].map((q) => (
                  <button
                    key={q}
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setInput(q); }}
                    disabled={llmConfigured === false}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                Tool results are routed through the gateway and appear in the Audit Log.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`chat-message ${msg.role}`}>
              <div className="chat-avatar">
                {msg.role === 'user' ? '👤' : msg.role === 'system' ? '⚙' : '🤖'}
              </div>
              <div>
                <div className="chat-bubble">{msg.content}</div>

                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="chat-tool-calls">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                        {msg.toolCalls.length} tool{msg.toolCalls.length > 1 ? 's' : ''} called
                      </strong>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setExpandedTool(expandedTool === i ? null : i)}
                        title="Expand / collapse tool details"
                      >
                        {expandedTool === i ? '▲' : '▼'}
                      </button>
                    </div>
                    {expandedTool === i &&
                      msg.toolCalls.map((tc: any, j: number) => (
                        <div key={j} className="chat-tool-call">
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span className="tool-name">{tc.server}__{tc.tool}</span>
                            <span className={`badge ${tc.success ? 'badge-success' : 'badge-error'}`} style={{ fontSize: 10 }}>
                              {tc.success ? '✓ OK' : '✗ Error'}
                            </span>
                          </div>
                          <div style={{ marginBottom: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                            Arguments:{' '}
                            <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: '4px', display: 'inline-block', whiteSpace: 'pre-wrap' }}>
                              {formatToolArgs(tc.args)}
                            </code>
                          </div>
                          <div style={{ marginBottom: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                            Duration: {tc.durationMs}ms
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', background: 'var(--bg-input)', padding: 10, borderRadius: '6px', border: '1px solid var(--border)', maxHeight: 220, overflow: 'auto' }}>
                            {tc.result?.substring(0, 2000)}{tc.result?.length > 2000 ? '\n… (truncated — see Audit Log for full result)' : ''}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-message assistant">
              <div className="chat-avatar">🤖</div>
              <div className="chat-bubble">
                <span style={{ display: 'inline-block', width: 14, height: 14, marginRight: 8, verticalAlign: 'middle', borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
                Thinking…
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <input
            className="form-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={llmConfigured === false ? 'LLM not configured' : 'Ask about products, orders, customers, inventory…'}
            disabled={loading || llmConfigured === false}
            autoFocus
          />
          <button className="btn btn-primary" onClick={handleSend} disabled={loading || !input.trim() || llmConfigured === false}>
            Send
          </button>
        </div>
      </div>
    </>
  );
}
