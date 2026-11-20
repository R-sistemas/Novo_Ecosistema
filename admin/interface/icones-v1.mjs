const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  bag:'<path d="M4 8h16l-1 13H5L4 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  shopping:'<circle cx="9" cy="20" r="1"/><circle cx="20" cy="20" r="1"/><path d="M1 2h2l3 12h14l2-9H4"/>',
  box:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M18 8a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87"/>',
  palette:'<circle cx="12" cy="12" r="10"/><circle cx="8" cy="8" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="6" cy="14" r="1"/><path d="M17 14c-2 0-4 3-2 5 1.5 2 6-.5 6-4a3 3 0 0 0-4-1Z"/>',
  wallet:'<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h15V7H4"/><path d="M16 13h5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  activity:'<path d="M3 12h5l3-8 4 16 3-8h3"/>'
};
export function ico(n,s=18){return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]||icons.grid}</svg>`}
