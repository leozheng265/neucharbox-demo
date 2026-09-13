// Simple line icons (24×24, stroke-based) for device tiles. Keyed by device `icon` name.
const S = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  lamp:       S('<path d="M9 3h6l3 8H6z"/><path d="M12 11v9"/><path d="M8 20h8"/>'),
  blinds:     S('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 8h16M4 12h16M4 16h16"/><path d="M12 3v3"/>'),
  moisture:   S('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/>'),
  pump:       S('<circle cx="12" cy="12" r="7"/><path d="M12 12l3-4M12 12l-4 2.5M12 12l1.5 4.5"/><path d="M12 19v2M19 12h2"/>'),
  camera:     S('<rect x="3" y="7" width="13" height="11" rx="2"/><path d="M16 11l5-3v9l-5-3z"/><circle cx="9.5" cy="12.5" r="2.2"/>'),
  thermostat: S('<path d="M10 4a2 2 0 0 1 4 0v9.5a3.5 3.5 0 1 1-4 0z"/><path d="M12 9v6"/><path d="M17 6h3M17 10h3"/>'),
  laser:      S('<rect x="2" y="9" width="9" height="6" rx="1"/><path d="M11 12h8"/><path d="M19 12l2-2M19 12l2 2M19 12l3 0"/>'),
  mirror:     S('<circle cx="12" cy="10" r="6"/><path d="M9 7l6 6M9 10l3 3"/><path d="M12 16v5M9 21h6"/>'),
  stage:      S('<rect x="3" y="12" width="18" height="6" rx="1"/><rect x="8" y="8" width="8" height="4" rx="1"/><path d="M3 5h18M3 5l2-1.5M3 5l2 1.5M21 5l-2-1.5M21 5l-2 1.5"/>'),
  meter:      S('<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.2"/><path d="M4 20h16"/>'),
  beamcam:    S('<rect x="3" y="6" width="14" height="12" rx="2"/><circle cx="10" cy="12" r="3.5"/><path d="M10 8.5v7M6.5 12h7"/><path d="M17 10h4v4h-4"/>'),
  bed:        S('<path d="M3 18V8M21 18v-6"/><path d="M3 12h18"/><path d="M3 12V9a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v3"/><path d="M12 12a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2"/>'),
  door:       S('<path d="M5 21V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="14.5" cy="12" r="1"/>'),
  motion:     S('<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/><path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"/>'),
  kettle:     S('<path d="M6 9h10l-1 11H7z"/><path d="M8 9a4 4 0 0 1 6 0"/><path d="M16 11h2a2 2 0 0 1 0 4h-1.5"/><path d="M11 3v2"/>'),
  bulb:       S('<path d="M9 18h6"/><path d="M10 21h4"/><path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.8-1.5 1.7-1.5 3.5h-4c0-1.8-.7-2.7-1.5-3.5z"/>'),
  conveyor:   S('<rect x="2" y="10" width="20" height="5" rx="2.5"/><circle cx="6" cy="12.5" r="1"/><circle cx="12" cy="12.5" r="1"/><circle cx="18" cy="12.5" r="1"/><rect x="8" y="5" width="6" height="5" rx="0.5"/>'),
  scanner:    S('<path d="M4 20V8a8 8 0 0 1 16 0v12"/><path d="M8 13v5M11 13v5M14 13v5M16.5 13v5"/>'),
  gate:       S('<path d="M4 12h7"/><path d="M11 12l7-6M11 12l7 6"/><path d="M18 6l-1-3M18 6l-3 0M18 18l-1 3M18 18l-3 0"/>'),
  cart:       S('<rect x="3" y="9" width="14" height="7" rx="1"/><path d="M17 12h3l1 2v2h-4"/><circle cx="7" cy="18.5" r="1.5"/><circle cx="16" cy="18.5" r="1.5"/><path d="M6 9V6h8v3"/>'),
  dock:       S('<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-8h10v8"/><path d="M7 16h10"/>'),
  keylight:   S('<rect x="6" y="4" width="12" height="9" rx="1"/><path d="M12 13v8M9 21h6"/><path d="M3 8l2 0M19 8l2 0M4 3l1.5 1.5M20 3l-1.5 1.5"/>'),
  mic:        S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0"/><path d="M12 17v4M9 21h6"/>'),
  capture:    S('<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 7V4M12 7V4M16 7V4M8 20v-3M12 20v-3M16 20v-3"/><circle cx="12" cy="12" r="1.5"/>'),
  display:    S('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/><path d="M7 12l3-3 2 2 4-4"/>'),
  sign:       S('<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="8" cy="12" r="1.5"/><path d="M11.5 12h6"/>'),
  strip:      S('<path d="M3 12h18"/><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/><path d="M6 8v1M12 8v1M18 8v1M6 15v1M12 15v1M18 15v1"/>'),
  hub:        S('<rect x="3" y="9" width="18" height="7" rx="2.5"/><path d="M7 16v2M17 16v2"/><path d="M8 12.5h8"/>'),
  generic:    S('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  whatif:     S('<path d="M10.3 4.3a2 2 0 0 1 3.4 0l7.4 12.8a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z"/><path d="M12 9.5v4"/><path d="M12 16.8v.2"/>'), // "What if something fails?": a warning sign
};

export const icon = (name) => ICONS[name] || ICONS.generic;
