// Scans the signed-in Facebook Groups list. Only group names, IDs, and URLs are saved.
// Facebook renders this list lazily, so the scan scrolls until no more groups appear.
(function () {
  const GROUPS_KEY = 'fbgc_discovered_groups';
  const STATUS_KEY = 'fbgc_group_scan';
  const MAX_ROUNDS = 240;
  const IDLE_ROUNDS = 5;
  const WAIT_MS = 1200;
  const RESERVED = new Set([
    'joins', 'feed', 'feeds', 'discover', 'search', 'create', 'notifications',
    'your_groups', 'admin', 'settings', 'events', 'photos', 'files', 'members',
  ]);
  const graphByUrl = new Map();
  const graphByName = new Map();
  let running = false;

  function isListPage() {
    return /(^|\.)facebook\.com$/i.test(location.hostname)
      && /^\/groups\/(?:joins|your_groups)\/?$/i.test(location.pathname);
  }

  function cleanName(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, 250);
  }

  function groupUrl(value) {
    try {
      const url = new URL(value, location.origin);
      if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
      if (!match || RESERVED.has(match[1].toLowerCase())) return null;
      return 'https://www.facebook.com/groups/' + decodeURIComponent(match[1]) + '/';
    } catch {
      return null;
    }
  }

  function urlKey(value) {
    return groupUrl(value)?.toLowerCase() || null;
  }

  function rememberGraphGroup(node) {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id || node.group_id || node.gid || '');
    const name = cleanName(node.name?.text || node.name || node.group_name || node.display_name);
    const url = groupUrl(node.url || node.group_url || node.permalink || node.uri || '');
    const type = String(node.__typename || node.type || '').toLowerCase();
    if (!/^\d{5,}$/.test(id) || !name || (type !== 'group' && !url)) return;
    const record = {id, name, url: url || 'https://www.facebook.com/groups/' + id + '/'};
    graphByUrl.set(urlKey(record.url), record);
    graphByUrl.set(urlKey('https://www.facebook.com/groups/' + id + '/'), record);
    // A name is only used when it maps to exactly one ID in captured metadata.
    const nameKey = name.toLocaleLowerCase();
    const previous = graphByName.get(nameKey);
    if (previous === undefined) graphByName.set(nameKey, record);
    else if (previous?.id !== id) graphByName.set(nameKey, null);
  }

  function inspectGraphPayload(text) {
    if (!isListPage() || typeof text !== 'string') return;
    // GraphQL responses may contain several newline-delimited JSON objects.
    for (const line of text.split('\n')) {
      let parsed;
      try { parsed = JSON.parse(line.replace(/^(?:for\s*\(;;\);|while\s*\(1\);)/, '')); }
      catch { continue; }
      const stack = [parsed];
      let visited = 0;
      while (stack.length && visited++ < 100000) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (!Array.isArray(node)) rememberGraphGroup(node);
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') stack.push(value);
        }
      }
    }
  }

  document.addEventListener('_fbgc', (event) => {
    inspectGraphPayload(event.detail?.text);
  });

  function nameFromAnchor(anchor) {
    const raw = anchor.innerText || anchor.getAttribute('aria-label')
      || anchor.getAttribute('title') || anchor.textContent || '';
    const firstLine = String(raw).split(/[\r\n]/).map(cleanName).find(Boolean);
    return cleanName(firstLine);
  }

  function collectVisibleGroups(found) {
    for (const anchor of document.querySelectorAll('a[href]')) {
      const url = groupUrl(anchor.href);
      if (!url) continue;
      const name = nameFromAnchor(anchor);
      if (!name || /^\d+$/.test(name)) continue;
      const key = urlKey(url);
      const graph = graphByUrl.get(key) || graphByName.get(name.toLocaleLowerCase());
      const pathId = url.match(/\/groups\/(\d+)\//)?.[1] || null;
      const id = pathId || graph?.id || null;
      const previous = found.get(key);
      found.set(key, {
        id: id || previous?.id || null,
        name: graph?.name || (name.length > (previous?.name?.length || 0) ? name : previous.name),
        url,
      });
    }
  }

  function scrollTargets() {
    const targets = new Set([document.scrollingElement || document.documentElement]);
    for (const anchor of document.querySelectorAll('a[href*="/groups/"]')) {
      if (!groupUrl(anchor.href)) continue;
      let parent = anchor.parentElement;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight + 100 && parent.clientHeight > 100) {
          targets.add(parent);
          break;
        }
        parent = parent.parentElement;
      }
    }
    return [...targets];
  }

  function advanceScroll() {
    let moved = false;
    for (const target of scrollTargets()) {
      const before = target.scrollTop;
      target.scrollTop = Math.min(
        Math.max(0, target.scrollHeight - target.clientHeight),
        before + Math.max(500, target.clientHeight * 0.85),
      );
      moved = moved || target.scrollTop > before;
    }
    return moved;
  }

  function sortedGroups(found) {
    for (const [key, group] of found) {
      if (group.id) continue;
      const graph = graphByUrl.get(key) || graphByName.get(group.name.toLocaleLowerCase());
      if (graph?.id) found.set(key, {...group, id: graph.id, name: graph.name});
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function numericIdFromUrl(value) {
    const match = String(value || '').match(/(?:\/groups?\/|[?&](?:id|group_id)=)(\d{5,})(?:\D|$)/i);
    return match?.[1] || null;
  }

  async function resolveIdFromGroupPage(group) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const path = new URL(group.url).pathname;
      const response = await fetch(path, {credentials: 'include', signal: controller.signal});
      if (!response.ok) return null;
      const redirectedId = numericIdFromUrl(response.url);
      if (redirectedId) return redirectedId;
      const html = await response.text();
      const page = new DOMParser().parseFromString(html, 'text/html');
      const selectors = [
        'link[rel="canonical"]',
        'meta[property="og:url"]',
        'meta[property="al:android:url"]',
        'meta[property="al:ios:url"]',
      ];
      for (const selector of selectors) {
        const element = page.querySelector(selector);
        const id = numericIdFromUrl(element?.href || element?.content);
        if (id) return id;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function saveProgress(found, state, rounds) {
    const groups = sortedGroups(found);
    const unresolved = groups.filter((group) => !group.id).length;
    await chrome.storage.local.set({
      [GROUPS_KEY]: groups,
      [STATUS_KEY]: {state, count: groups.length, unresolved, rounds, updatedAt: Date.now()},
    });
  }

  async function scan() {
    if (running) return;
    if (!isListPage()) throw new Error('Abra facebook.com/groups/joins/ antes de coletar.');
    running = true;
    const found = new Map();
    let idle = 0;
    let rounds = 0;
    try {
      await saveProgress(found, 'running', rounds);
      // Start at the top even when the user had already scrolled the list.
      for (const target of scrollTargets()) target.scrollTop = 0;
      for (let attempt = 0; attempt < 15; attempt++) {
        collectVisibleGroups(found);
        if (found.size > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (found.size === 0) throw new Error('Nenhum grupo encontrado na lista.');
      while (rounds < MAX_ROUNDS && idle < IDLE_ROUNDS) {
        const before = found.size;
        collectVisibleGroups(found);
        const moved = advanceScroll();
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        collectVisibleGroups(found);
        idle = found.size === before && !moved ? idle + 1 : 0;
        rounds += 1;
        await saveProgress(found, 'running', rounds);
      }
      for (const [key, group] of found) {
        if (group.id) continue;
        await saveProgress(found, 'resolving', rounds);
        const id = await resolveIdFromGroupPage(group);
        if (id) found.set(key, {...group, id});
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await saveProgress(found, rounds >= MAX_ROUNDS ? 'limit' : 'complete', rounds);
    } catch (error) {
      await saveProgress(found, 'error', rounds);
      await chrome.storage.local.set({[STATUS_KEY]: {
        state: 'error', count: found.size, unresolved: sortedGroups(found).filter((group) => !group.id).length,
        rounds, updatedAt: Date.now(), error: String(error?.message || error),
      }});
      throw error;
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'scan_group_list') return false;
    if (running) {
      sendResponse({ok: true, alreadyRunning: true});
      return false;
    }
    if (!isListPage()) {
      sendResponse({ok: false, error: 'Abra facebook.com/groups/joins/ antes de coletar.'});
      return false;
    }
    void scan().catch((error) => console.warn('FBGC[group scan]:', error));
    sendResponse({ok: true});
    return false;
  });
})();
