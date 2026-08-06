'use client';

import ChatInterface from '@/components/ChatInterface';
import { Bot, Shield, Zap, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';

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

export default function AIPortalPage() {
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
      display:       'flex',
      flexDirection: 'column',
      // Full viewport minus the top bar (56px mobile / 0px desktop since pos mode)
      height:        'calc(100dvh - 56px)',
      overflow:      'hidden',
      padding:       '12px',
      gap:           '10px',
    }}>

      {/* ── Compact header ──────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        flexWrap:       'wrap',
        gap:            '8px',
        padding:        '10px 14px',
        background:     'var(--bg-card)',
        borderRadius:   'var(--radius-lg)',
        border:         '1px solid var(--border)',
        flexShrink:     0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            padding:         '8px',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderRadius:    'var(--radius-md)',
            border:          '1px solid rgba(99, 102, 241, 0.2)',
            color:           'var(--primary-light)',
          }}>
            <Bot size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                LUX SYSTEMS ARCHITECT Portal
              </span>
              <span style={{
                padding:         '1px 7px',
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                border:          '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius:    '4px',
                fontSize:        '9px',
                fontWeight:      600,
                color:           'var(--primary-light)',
                textTransform:   'uppercase',
                letterSpacing:   '0.05em',
              }}>
                Gemini Flash
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Enterprise Operational Intelligence &amp; Forensic Analysis Engine
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 10px',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: 'var(--success)',
            borderRadius: '100px',
            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
            border: '1px solid rgba(16, 185, 129, 0.2)',
          }}>
            <Shield size={11} /> Secure
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 10px',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            color: 'var(--primary-light)',
            borderRadius: '100px',
            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
            border: '1px solid rgba(99, 102, 241, 0.2)',
          }}>
            <Zap size={11} /> Online
          </div>
        </div>
      </div>
      
      {fact && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(99, 102, 241, 0.05)',
          border: '1px solid rgba(99, 102, 241, 0.15)',
          borderRadius: 'var(--radius-lg)',
          display: 'flex', gap: 10, alignItems: 'center',
          flexShrink: 0,
        }}>
          <Zap size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div>
             <div style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--accent)', letterSpacing: '0.08em', marginBottom: 2 }}>System Intelligence:</div>
             <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
               {fact}
             </p>
          </div>
        </div>
      )}

      {/* ── Chat — takes ALL remaining space ───────────────────── */}
      {/* FIX: flex:1 + minHeight:0 is the key.
          Without minHeight:0, a flex child won't shrink below its
          content size, so the chat box refuses to fill the remaining space.
          With both set, it correctly fills everything between the header
          and the bottom of the viewport. */}
      <div style={{
        flex:        1,
        minHeight:   0,       /* critical — allows flex child to shrink */
        borderRadius: 'var(--radius-xl)',
        overflow:    'hidden',
        border:      '1px solid var(--border)',
      }}>
        <ChatInterface isEmbedded={true} />
      </div>

      {/* ── Feature cards — desktop only ─────────────────────── */}
      {/* Hidden on mobile via inline media approach:
          We use a CSS class defined in globals.css.
          On screens < 768px these are hidden so chat gets full height. */}
      <div className="ai-portal-features" style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap:                 '10px',
        flexShrink:          0,
      }}>
        {[
          { title: 'Ledger Integrity',  body: 'LUX CORE monitors all double-entry movements for variance forensics.' },
          { title: 'Stock Forensics',   body: 'Automated reconciliation of stock takes against virtual ledger balances.' },
          { title: 'Security Authority',body: 'Strict channel isolation and role-based access control enforcement.' },
        ].map(card => (
          <div key={card.title} style={{
            padding:         '12px 14px',
            backgroundColor: 'var(--bg-card)',
            borderRadius:    'var(--radius-lg)',
            border:          '1px solid var(--border)',
          }}>
            <h4 style={{ margin: '0 0 5px', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {card.title}
            </h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {card.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
