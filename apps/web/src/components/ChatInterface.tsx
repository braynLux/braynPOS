'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Send, User, Loader2, MessageCircle, X, Bot,
  BarChart2, PieChart as PieIcon, Activity, Zap,
} from 'lucide-react';
import Markdown from 'react-markdown';
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { useAuthStore } from '@/stores/auth.store';
import { api } from '@/lib/api-client';

interface Message {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  timestamp: Date;
}

interface ChatInterfaceProps {
  isEmbedded?: boolean;
}

const SUGGESTED_QUESTIONS = [
  'How do I void a sale?',
  'How are margins calculated?',
  'How are payroll deductions calculated?',
  'Opening stock window help',
  'How to handle branch transfers?',
  'Customer loyalty point redemption',
  'Serial number tracking workflow',
  'LPO vs Receiving Purchase',
  'System offline sync status',
];

const BRAYN_FACTS = [
  "Did you know? Stock takes left untouched for over 72 hours are automatically cancelled to keep your data clean.",
  "Did you know? You can now sort your Debtors by 'Due Date' to prioritize urgent collections.",
  "Did you know? LUX AI can draw charts! Ask me to 'Show sales as a bar chart' for instance.",
  "Did you know? You can toggle the 'Powered by LUX' footer in your receipt settings.",
  "Did you know? Opening Stock allows you to input initial inventory without creating accounting ledger entries.",
  "Did you know? Each channel can have its own custom commission rates, overriding the global 12% default.",
  "Did you know? Our forensic engine tracks every unit of stock across transfers for 100% accountability.",
  "Did you know? Managers can 'Freeze' commissions for a specific month in the Global Business Settings.",
  "Did you know? Stock valuation in your channel report uses Weighted Average Cost (WAC) for financial precision.",
  "Did you know? You can use global search to find items by SKU, Name, or even Category tags."
];

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

// ── Chart renderer ───────────────────────────────────────────────────
function ChartRenderer({ json }: { json: string }) {
  try {
    const { type, title, data } = JSON.parse(json);
    return (
      <div style={{
        marginTop: 12, padding: 14,
        background: 'var(--bg-card)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        width: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          {type === 'bar' ? <BarChart2 size={16} /> : type === 'pie' ? <PieIcon size={16} /> : <Activity size={16} />}
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{title || 'Analysis'}</span>
        </div>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            {type === 'bar' ? (
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            ) : type === 'area' ? (
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--primary)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="var(--primary)" fill="url(#cg)" />
              </AreaChart>
            ) : type === 'pie' ? (
              <PieChart>
                <Pie data={data} innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value">
                  {data.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            ) : (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  } catch {
    return null;
  }
}

// ── Message bubble ────────────────────────────────────────────────────
function MessageBubble({ msg, isStreaming }: { msg: Message; isStreaming?: boolean }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
        <div style={{
          maxWidth: '78%',
          padding: '10px 14px',
          borderRadius: '18px 18px 4px 18px',
          background: 'var(--primary)',
          color: 'white',
          fontSize: '0.875rem',
          lineHeight: 1.55,
          wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 4, alignItems: 'flex-start' }}>
      {/* Bot avatar */}
      <div style={{
        width: 28, height: 28,
        borderRadius: '50%',
        background: 'rgba(99,102,241,0.12)',
        border: '1px solid rgba(99,102,241,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, marginTop: 2,
        color: 'var(--primary)',
      }}>
        <Bot size={15} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {isStreaming && !msg.content ? (
          // Typing indicator
          <div style={{ display: 'flex', gap: 4, padding: '10px 4px', alignItems: 'center' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--text-muted)',
                animation: `bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
              }} />
            ))}
          </div>
        ) : (
          <div style={{
            fontSize: '0.875rem',
            lineHeight: 1.65,
            color: 'var(--text-primary)',
            wordBreak: 'break-word',
          }} className="brayn-markdown">
            {msg.content.includes('```chart') ? (
              <>
                <Markdown>{msg.content.split('```chart')[0]}</Markdown>
                <ChartRenderer json={msg.content.split('```chart')[1].split('```')[0]} />
                <Markdown>{msg.content.split('```chart')[1].split('```').slice(1).join('```')}</Markdown>
              </>
            ) : (
              <Markdown>{msg.content}</Markdown>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state with suggestions ──────────────────────────────────────
function EmptyState({ onSelect }: { onSelect: (q: string) => void }) {
  const user = useAuthStore(s => s.user);
  const [fact, setFact] = useState<string>('');

  useEffect(() => {
    // Unique "Did you know" logic
    const userId = user?.id || 'guest';
    const storageKey = `brayn_seen_facts_${userId}`;
    const seenIndices: number[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
    
    // Find an index not already seen
    const available = BRAYN_FACTS.map((_, i) => i).filter(i => !seenIndices.includes(i));
    
    let selectedIndex: number;
    if (available.length === 0) {
      // If all seen, reset for this user
      selectedIndex = Math.floor(Math.random() * BRAYN_FACTS.length);
      localStorage.setItem(storageKey, JSON.stringify([selectedIndex]));
    } else {
      selectedIndex = available[Math.floor(Math.random() * available.length)];
      localStorage.setItem(storageKey, JSON.stringify([...seenIndices, selectedIndex]));
    }
    setFact(BRAYN_FACTS[selectedIndex]);
  }, [user?.id]);

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
      gap: 20,
    }}>
      {/* Logo mark */}
      <div style={{
        width: 52, height: 52,
        borderRadius: '50%',
        background: 'rgba(99,102,241,0.1)',
        border: '1px solid rgba(99,102,241,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--primary)',
      }}>
        <Bot size={26} />
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: '1.2rem', color: 'var(--text-primary)', marginBottom: 4 }}>
          Hello, {user?.username || 'there'}! 👋
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          How can I assist your business today?
        </div>
        
        {/* Unique Fact Card */}
        {fact && (
          <div style={{
            maxWidth: 380,
            background: 'rgba(99, 102, 241, 0.05)',
            border: '1px solid rgba(99, 102, 241, 0.15)',
            padding: '12px 16px',
            borderRadius: 14,
            marginBottom: 20,
            textAlign: 'left',
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
               <Zap size={16} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
               <p style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                 {fact}
               </p>
            </div>
          </div>
        )}
      </div>

      {/* Suggestion chips — 2 columns, compact */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 8,
        width: '100%',
        maxWidth: 480,
      }}>
        {SUGGESTED_QUESTIONS.slice(0, 6).map(q => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            style={{
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              cursor: 'pointer',
              textAlign: 'left',
              lineHeight: 1.4,
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
export default function ChatInterface({ isEmbedded = false }: ChatInterfaceProps) {
  const { accessToken: token, user } = useAuthStore();

  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen]       = useState(isEmbedded);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      id:        Date.now().toString(),
      role:      'user',
      content:   text.trim(),
      timestamp: new Date(),
    };

    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id:        assistantId,
      role:      'assistant',
      content:   '',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsLoading(true);

    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto';

    try {
      let textToSend = text;
      
      // Personalization Injection: Force name awareness on first message
      if (messages.length === 0 && user?.username) {
        textToSend = `[IDENTITY_CONTEXT: User is ${user.username}]\n${text}`;
      }

      const { reply } = await api.post<{ reply: string }>(
        '/support/ai-portal/chat',
        { message: textToSend },
        token || undefined
      );
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: reply } : m
      ));
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: `⚠️ ${err?.message || 'Service unavailable. Please try again.'}` }
          : m
      ));
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Chat window ───────────────────────────────────────────────────
  const chatWindow = (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      width:          '100%',
      height:         '100%',
      background:     'var(--bg-primary)',
      borderRadius:   isEmbedded ? 'var(--radius-xl)' : 'var(--radius-xl)',
      border:         '1px solid var(--border)',
      overflow:       'hidden',
    }}>

      {/* Header — compact */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '12px 16px',
        borderBottom:   '1px solid var(--border)',
        background:     'var(--bg-secondary)',
        flexShrink:     0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--primary)',
          }}>
            <Bot size={17} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>LuxAI</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Online
              </span>
            </div>
          </div>
        </div>

        {!isEmbedded && (
          <button
            onClick={() => setIsOpen(false)}
            style={{
              width: 32, height: 32, border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 8,
            }}
          >
            <X size={18} />
          </button>
        )}

        {isEmbedded && messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            New chat
          </button>
        )}
      </div>

      {/* Messages / Empty state */}
      <div style={{
        flex:      1,
        overflowY: 'auto',
        display:   'flex',
        flexDirection: 'column',
        padding:   messages.length === 0 ? 0 : '16px 16px 8px',
        gap:       12,
        // Mobile: no bounce scroll on iOS
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
      }}>
        {messages.length === 0 ? (
          <EmptyState onSelect={q => handleSend(q)} />
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isStreaming={isLoading && idx === messages.length - 1}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar — Claude-style */}
      <div style={{
        padding:    '12px 14px',
        borderTop:  '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
        // iOS safe area
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
      }}>
        <div style={{
          display:      'flex',
          alignItems:   'flex-end',
          gap:          8,
          background:   'var(--bg-input)',
          border:       '1px solid var(--border)',
          borderRadius: 14,
          padding:      '6px 6px 6px 14px',
          transition:   'border-color 0.15s',
        }}
          onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--primary)'}
          onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Message LuxAI…"
            rows={1}
            disabled={isLoading}
            style={{
              flex:       1,
              background: 'transparent',
              border:     'none',
              outline:    'none',
              resize:     'none',
              color:      'var(--text-primary)',
              fontSize:   '0.875rem',
              lineHeight: 1.5,
              fontFamily: 'inherit',
              padding:    '4px 0',
              maxHeight:  '120px',
              overflowY:  'auto',
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            style={{
              width:          36,
              height:         36,
              flexShrink:     0,
              background:     input.trim() && !isLoading ? 'var(--primary)' : 'var(--bg-card)',
              border:         '1px solid var(--border)',
              borderRadius:   10,
              color:          input.trim() && !isLoading ? 'white' : 'var(--text-muted)',
              cursor:         input.trim() && !isLoading ? 'pointer' : 'default',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              transition:     'background 0.15s, color 0.15s',
            }}
          >
            {isLoading
              ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              : <Send size={16} />
            }
          </button>
        </div>
        <p style={{
          fontSize:   '0.65rem',
          color:      'var(--text-muted)',
          textAlign:  'center',
          marginTop:  8,
          letterSpacing: '0.04em',
        }}>
          LuxAI · Shift+Enter for new line
        </p>
      </div>
    </div>
  );

  // ── Embedded mode: render directly ───────────────────────────────
  if (isEmbedded) {
    return chatWindow;
  }

  // ── Floating mode ────────────────────────────────────────────────
  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        aria-label="Toggle LuxAI"
        style={{
          position:        'fixed',
          bottom:          24,
          right:           24,
          width:           52,
          height:          52,
          borderRadius:    '50%',
          background:      'var(--primary)',
          color:           'white',
          border:          'none',
          cursor:          'pointer',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          boxShadow:       'var(--shadow-lg)',
          zIndex:          1001,
          transition:      'transform 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1)'}
      >
        {isOpen ? <X size={22} /> : <MessageCircle size={22} />}
      </button>

      {/* Floating window */}
      {isOpen && (
        <div style={{
          position:  'fixed',
          bottom:    88,
          right:     24,
          width:     'min(480px, calc(100vw - 32px))',
          height:    'min(680px, calc(100dvh - 120px))',
          zIndex:    1000,
          // Slide up animation
          animation: 'chatSlideUp 0.2s ease',
        }}>
          {chatWindow}
        </div>
      )}

      <style>{`
        @keyframes chatSlideUp {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30%            { transform: translateY(-5px); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .brayn-markdown p  { margin: 0 0 8px; }
        .brayn-markdown p:last-child { margin-bottom: 0; }
        .brayn-markdown ul, .brayn-markdown ol { margin: 4px 0 8px 18px; }
        .brayn-markdown li { margin-bottom: 3px; }
        .brayn-markdown code {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px 5px;
          font-size: 0.82em;
          font-family: monospace;
        }
        .brayn-markdown pre {
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px;
          overflow-x: auto;
          margin: 8px 0;
        }
        .brayn-markdown pre code {
          background: none;
          border: none;
          padding: 0;
        }
        .brayn-markdown strong { font-weight: 600; }
        .brayn-markdown h1, .brayn-markdown h2, .brayn-markdown h3 {
          margin: 8px 0 4px;
          font-weight: 600;
          line-height: 1.3;
        }
        .brayn-markdown h1 { font-size: 1.05rem; }
        .brayn-markdown h2 { font-size: 0.95rem; }
        .brayn-markdown h3 { font-size: 0.875rem; }
        @media (max-width: 768px) {
          .brayn-markdown { font-size: 0.875rem; }
        }
      `}</style>
    </>
  );
}
