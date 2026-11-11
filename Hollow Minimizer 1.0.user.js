// ==UserScript==
// @name         Hollow Minimizer
// @namespace    hollow-minimizer
// @version      1.0
// @description  PartyScape: a "▾ Minimize" button on the Hollow Choir and Party Raid fight windows. The fight keeps going; a small draggable pill shows the boss HP, the timers and your HP, and brings the window back with a click. Read-only: nothing is sent to the game.
// @author       im bobman
// @match        https://partyscape.club/*
// @match        https://www.partyscape.club/*
// @match        https://*.partyscape.club/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

/*
 * Based on "PartyScape Custom UI Suite" (MIT), https://greasyfork.org/scripts/600346
 */

(function () {
  'use strict';

  const safe = (fn) => { try { fn(); } catch (e) { console.warn('[Hollow Minimizer]', e); } };
  const isOn = () => true;
  function addStyle(id, css) {
    const el = document.createElement('style');
    el.id = 'hm-css-' + id;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
    return el;
  }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:100001;padding:8px 14px;border-radius:6px;background:rgba(20,16,26,.95);color:#eee;border:1px solid #968287;font-size:13px;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function selfName() {
    const card = document.querySelector('[data-qa="header-own-card"]');
    if (card) for (const x of card.querySelectorAll('*')) {
      const s = x.children.length ? '' : (x.textContent || '').trim();
      if (s && /[a-z]/i.test(s) && !/\d+\s*\/\s*\d+/.test(s) && s.length <= 24) return s;
    }
    const el = document.querySelector('[data-combat-card] .panel-primary .font-bold');
    return el ? (el.textContent || '').trim() : '';
  }

  addStyle('choirMin', `
    [data-ps-choir-min] { display: none !important; }
    #ps-choir-pill {
      position: fixed; z-index: 99990; min-width: 190px; max-width: 260px;
      padding: 7px 10px; border-radius: 8px; cursor: pointer; user-select: none; touch-action: none;
      background: var(--c-panel, #221c2c); color: var(--c-text, #eee);
      border: 2px solid var(--c-frame, #968287); box-shadow: 0 6px 18px rgba(0,0,0,.55);
      font-size: 12px; line-height: 1.35;
    }
    #ps-choir-pill:hover { border-color: var(--ps-hl, #e8c96a); }
    #ps-choir-pill.drag { cursor: grabbing; opacity: .85; }
    #ps-choir-pill .pcp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    #ps-choir-pill .pcp-name { font-weight: 700; color: var(--ps-hl, #e8c96a); white-space: nowrap; }
    #ps-choir-pill .pcp-go { font-size: 11px; padding: 1px 7px; border-radius: 4px; border: 1px solid var(--c-frame, #968287); white-space: nowrap; }
    #ps-choir-pill .pcp-bar { height: 5px; border-radius: 3px; margin: 5px 0 4px; background: rgba(255,255,255,.12); overflow: hidden; }
    #ps-choir-pill .pcp-bar > i { display: block; height: 100%; background: #c0454a; transition: width .3s; }
    #ps-choir-pill .pcp-line { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; opacity: .85; font-variant-numeric: tabular-nums; }
    #ps-choir-pill.urgent { border-color: #e0574f; animation: psChoirPulse 1s ease-in-out infinite; }
    #ps-choir-pill.urgent .pcp-split { color: #ff8a80; font-weight: 700; opacity: 1; }
    @keyframes psChoirPulse { 50% { box-shadow: 0 0 0 4px rgba(224,87,79,.35), 0 6px 18px rgba(0,0,0,.55); } }
    button[data-ps-choir-btn] { margin-left: 4px; }
  `);

  const CHOIR_URGENT_MS = 10000;
  let chMin = false;
  let chGoneAt = 0;

  const chBtn = document.createElement('div');
  chBtn.id = 'ps-choir-pill';
  chBtn.title = 'Click: show the fight window again · Drag: move';
  chBtn.innerHTML = '<div class="pcp-top"><span class="pcp-name">🎵 Hollow Choir</span><span class="pcp-go">▴ Restore</span></div>'
    + '<div class="pcp-bar"><i></i></div>'
    + '<div class="pcp-line"><span class="pcp-hp"></span><span class="pcp-weak"></span></div>'
    + '<div class="pcp-line"><span class="pcp-split"></span><span class="pcp-me"></span></div>';
  let chKind = 'choir';
  const chEl = {
    name: chBtn.querySelector('.pcp-name'),
    bar: chBtn.querySelector('.pcp-bar > i'), hp: chBtn.querySelector('.pcp-hp'), weak: chBtn.querySelector('.pcp-weak'),
    split: chBtn.querySelector('.pcp-split'), me: chBtn.querySelector('.pcp-me'),
  };

  let chPos = null;
  try { chPos = JSON.parse(GM_getValue('choirPillPos', 'null')); } catch (e) { chPos = null; }
  function applyChoirPos() {
    const w = chBtn.offsetWidth || 200, h = chBtn.offsetHeight || 80;
    const x = chPos ? chPos.x : window.innerWidth - w - 16;
    const y = chPos ? chPos.y : window.innerHeight - h - 90;
    chBtn.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, x)) + 'px';
    chBtn.style.top = Math.max(4, Math.min(window.innerHeight - h - 4, y)) + 'px';
  }
  window.addEventListener('resize', () => { if (chBtn.isConnected) applyChoirPos(); });

  (() => {
    let d = null;
    chBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = chBtn.getBoundingClientRect();
      d = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
      chBtn.setPointerCapture(e.pointerId);
    });
    chBtn.addEventListener('pointermove', (e) => {
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      d.moved = true; chBtn.classList.add('drag');
      chPos = { x: d.ox + dx, y: d.oy + dy };
      applyChoirPos();
    });
    const end = () => {
      if (!d) return;
      const moved = d.moved; d = null;
      chBtn.classList.remove('drag');
      if (moved) GM_setValue('choirPillPos', JSON.stringify(chPos));
      else choirRestore();
    };
    chBtn.addEventListener('pointerup', end);
    chBtn.addEventListener('pointercancel', () => { d = null; chBtn.classList.remove('drag'); });
  })();

  function choirRoot() {
    const anchor = document.querySelector('[data-qa="choir-leave"]') || document.querySelector('[data-qa="choir-stage"]');
    if (!anchor) return null;
    let root = anchor.closest('.fixed.inset-0');
    if (!root) {
      for (let n = anchor.parentElement; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') { root = n; break; }
      }
    }
    if (!root || root === document.body || root.querySelector('[data-qa="notif-bell"]')) return null;
    return root;
  }

  function raidRoot() {
    for (const el of document.querySelectorAll('.fixed.inset-0')) {
      if (el === chBtn || el.querySelector('[data-qa="notif-bell"]')) continue;
      if ([...el.querySelectorAll('.font-display')].some((x) => /^\s*PARTY RAID/i.test(x.textContent || ''))) return el;
    }
    return null;
  }
  const raidRetreat = (root) => [...root.querySelectorAll('button')].find((b) => /retreat/i.test(b.textContent || '') && !b.hasAttribute('data-ps-choir-btn'));
  const chSelf = () => selfName();
  function renderRaidPill(root) {
    const bossEl = [...root.querySelectorAll('.font-display')].find((x) => /\bLv\s*\d/i.test(x.textContent || '') && !/PARTY RAID/i.test(x.textContent || ''));
    const boss = bossEl ? (bossEl.textContent || '').replace(/\s*Lv\s*\d+.*/i, '').trim() : 'Raid boss';
    setText(chEl.name, '⚔️ ' + boss.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()));
    const hpLab = [...root.querySelectorAll('span')].find((x) => !x.children.length && /^boss hp$/i.test((x.textContent || '').trim()));
    const hpRow = hpLab && hpLab.parentElement;
    const hpTxt = hpRow && hpRow.lastElementChild ? (hpRow.lastElementChild.textContent || '').trim() : '';
    const fill = hpRow && hpRow.nextElementSibling ? hpRow.nextElementSibling.querySelector('.h-full') : null;
    const pct = fill ? parseFloat(fill.style.width) : NaN;
    if (!isNaN(pct)) chEl.bar.style.width = pct.toFixed(1) + '%';
    setText(chEl.hp, (hpTxt || '--') + (isNaN(pct) ? '' : '  (' + pct.toFixed(0) + '%)'));
    setText(chEl.weak, root.querySelector('[data-qa="raid-hard-tag"]') ? 'Hard' : '');
    const esc = (root.textContent || '').match(/escapes in\s*(\d+(?::\d{2}){1,2})/i);
    setText(chEl.split, esc ? '⏳ ' + esc[1] : '');

    let me = '', low = false;
    const self = (chSelf() || '').toLowerCase();
    root.querySelectorAll('.rounded.border.p-2').forEach((card) => {
      if (me || !self) return;
      const nm = chTxt('.font-semibold', card);
      if (nm.toLowerCase() !== self) return;
      const hp = chTxt('.tabular-nums.opacity-70', card), dmg = chTxt('.text-gold.tabular-nums', card);
      const m = hp.match(/(\d[\d\s]*)\s*\/\s*(\d[\d\s]*)/);
      if (m) low = +m[1].replace(/\s/g, '') <= 0.3 * +m[2].replace(/\s/g, '');
      me = 'You ' + (hp || '--') + (dmg ? ' · ' + dmg + ' dmg' : '');
    });
    const rank = self ? [...root.querySelectorAll('span')].find((x) => /\(\d+%\)/.test(x.textContent || '') && (x.textContent || '').toLowerCase().includes(self)) : null;
    const r = rank && (rank.textContent || '').match(/^\s*(🥇|🥈|🥉|\d+\.)/);
    if (r) { const n = { '🥇': 1, '🥈': 2, '🥉': 3 }[r[1]] || parseInt(r[1], 10); me += ' · ' + n + (n % 100 > 10 && n % 100 < 14 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
    setText(chEl.me, me);
    chBtn.classList.toggle('urgent', low);
  }

  function ensureChoirMinButton() {
    const raid = raidRoot();
    if (raid) {
      const ret = raidRetreat(raid);
      if (ret && ret.parentElement && !ret.parentElement.querySelector('button[data-ps-choir-btn]')) {
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('data-ps-choir-btn', '1');
        b.className = 'btn text-[11px] px-2 py-0.5 min-h-[44px] lg:min-h-0';
        b.textContent = '▾ Minimize';
        b.title = 'Hide this window, the fight keeps going. A small pill brings it back.';
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); choirMinimize(); });
        ret.insertAdjacentElement('beforebegin', b);
      }
    }
    const leave = document.querySelector('[data-qa="choir-leave"]');
    if (!leave || !leave.parentElement) return;
    if (leave.parentElement.querySelector('button[data-ps-choir-btn]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-ps-choir-btn', '1');
    b.className = 'btn text-[11px] px-2 py-0.5 min-h-[44px] lg:min-h-0';
    b.textContent = '▾ Minimize';
    b.title = 'Hide this window, the fight keeps going. A small pill brings it back.';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); choirMinimize(); });
    leave.insertAdjacentElement('afterend', b);
  }

  function choirMinimize() {
    chMin = true;
    safe(choirTick);
  }

  function choirRestore() {
    chMin = false;
    document.querySelectorAll('[data-ps-choir-min]').forEach((e) => e.removeAttribute('data-ps-choir-min'));
    chBtn.remove();
  }

  const chTxt = (sel, root) => { const e = (root || document).querySelector(sel); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };

  function renderChoirPill(root) {
    if (chKind === 'raid') { renderRaidPill(root); return; }
    setText(chEl.name, '🎵 Hollow Choir');
    const stage = root.querySelector('[data-qa="choir-stage"]');
    if (stage) {
      const fill = stage.querySelector('.bar > div');
      const pct = fill ? parseFloat(fill.style.width) : NaN;
      if (!isNaN(pct)) chEl.bar.style.width = pct.toFixed(1) + '%';
      const hpTxt = fill ? (fill.parentElement.nextElementSibling || {}).textContent || '' : '';
      setText(chEl.hp, (hpTxt.trim() || '--') + (isNaN(pct) ? '' : '  (' + pct.toFixed(0) + '%)'));
    }
    const weak = root.querySelector('[data-qa="choir-weakness"]');
    setText(chEl.weak, weak ? 'Weak: ' + (weak.getAttribute('data-weak') || '?') : '');
    const split = root.querySelector('[data-qa="choir-split"]');
    const ms = split ? parseInt(split.getAttribute('data-ms'), 10) : NaN;
    const voices = root.querySelector('[data-qa="choir-voices"]');
    const vTxt = voices ? ' · Voices ' + voices.getAttribute('data-ready') + '/' + voices.getAttribute('data-needed') : '';
    setText(chEl.split, isNaN(ms) ? '' : 'Split ' + Math.max(0, Math.ceil(ms / 1000)) + 's' + vTxt);
    chBtn.classList.toggle('urgent', !isNaN(ms) && ms <= CHOIR_URGENT_MS);
    let me = '';
    root.querySelectorAll('[data-qa="choir-fighter"]').forEach((f) => {
      if (me) return;
      const name = chTxt('.font-semibold', f);
      if (name.toLowerCase() === selfName().toLowerCase()) me = 'You ' + (chTxt('.tabular-nums.opacity-70', f) || '--');
    });
    setText(chEl.me, me);
  }

  function choirTick() {
    if (!isOn('choirMin')) return;
    ensureChoirMinButton();
    const choir = choirRoot();
    const root = choir || raidRoot();
    chKind = choir ? 'choir' : 'raid';
    if (!root) {
      if (!chMin) return;
      if (!chGoneAt) chGoneAt = Date.now();
      if (Date.now() - chGoneAt > 3000) choirRestore();
      return;
    }
    chGoneAt = 0;
    if (!chMin) { if (chBtn.isConnected) chBtn.remove(); return; }
    if (!root.hasAttribute('data-ps-choir-min')) root.setAttribute('data-ps-choir-min', '1');
    if (!chBtn.isConnected) { document.body.appendChild(chBtn); applyChoirPos(); }
    renderChoirPill(root);
  }

  function choirOff() {
    choirRestore();
    document.querySelectorAll('button[data-ps-choir-btn]').forEach((b) => b.remove());
  }

  GM_registerMenuCommand('Hollow Choir: minimize / restore the fight window', () => { if (chMin) choirRestore(); else if (choirRoot()) choirMinimize(); else toast('No Hollow Choir fight on screen'); });

  function init() {
    setInterval(() => { if (!document.hidden) safe(choirTick); }, 1000);
    safe(choirTick);
  }
  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
