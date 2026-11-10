// Stammdaten des Europa-Szenarios: Staaten, Heeresstärken, Forschung, deutsche Ausgangslage.
// Heeresstärken sind auf die Provinzgröße heruntergerechnete Näherungen der Friedens- und
// Mobilmachungsstärken; die Verbände werden beim Kriegseintritt eines Staates aufgestellt.
import { type Cat, MODELS } from './units';

export interface Country {
  name: string;
  adj: string; // Kürzel vor Verbandsnamen
  cap: string; // Hauptstadt (Provinz-ID)
  color: string;
  q: number; // Güte der Truppe
  lag: number; // Rückstand der Ausrüstung in Jahren
  mob: number; // Anteil der Industrie, der in neue Verbände fließt
  army: Record<string, number>; // Schablone → Anzahl (Stand 1939)
  air: [number, number]; // Jagd- und Bomberstaffeln
  over?: number; // Anteil des Heeres in Übersee
}

const C = (name: string, adj: string, cap: string, color: string, q: number, lag: number, mob: number, army: Record<string, number>, air: [number, number] = [0, 0], over?: number): Country =>
  ({ name, adj, cap, color, q, lag, mob, army, air, over });

export const COUNTRIES: Record<string, Country> = {
  GER: C('Deutsches Reich', '', 'berlin', '#9aa08b', 1, 0, 0, {}),
  AUT: C('Österreich', 'Österr.', 'wien', '#c9b9a0', 0, 2, 0.4, { GI: 5, GM: 2, GO: 1 }, [1, 0]),
  CSR: C('Tschechoslowakei', 'Tschech.', 'prag', '#b7c7a2', 0, 1, 0.5, { GI: 12, GR: 4, GO: 3, GM: 2, GF: 4 }, [4, 3]),
  SVK: C('Slowakei', 'Slowak.', 'pressburg', '#a9b596', -1, 2, 0.4, { GI: 2, GO: 1 }),
  DZG: C('Freie Stadt Danzig', 'Danziger', 'danzig', '#b9b9a6', -1, 3, 0, { GG: 1 }),
  POL: C('Polen', 'Poln.', 'warschau', '#e4d3a0', 0, 2, 0.5, { GI: 24, GR: 6, GM: 2, GC: 8, GO: 1, GG: 3 }, [4, 3]),
  FRA: C('Frankreich', 'Franz.', 'paris', '#9fb3d6', 0, 0, 0.5, { GI: 40, GR: 18, GM: 4, GC: 3, GO: 5, GA: 5, GF: 8, GG: 4 }, [14, 8], 0.12),
  VIC: C('Vichy-Frankreich', 'Franz.', 'vichy', '#b9c4d6', -1, 1, 0.2, { GI: 6, GR: 6 }, [2, 1], 0.5),
  ENG: C('Großbritannien', 'Brit.', 'london', '#dcaaa8', 0, 0, 0.4, { GI: 18, GR: 8, GO: 2, GA: 2, GG: 4 }, [16, 10], 0.3),
  USA: C('Vereinigte Staaten', 'US-', '', '#9cc08c', 0, 0, 0.12, {}, [0, 0]),
  IRL: C('Irland', 'Irische', 'dublin', '#b5d6a8', -1, 3, 0.3, { GR: 2 }),
  BEL: C('Belgien', 'Belg.', 'bruessel', '#d9c07a', 0, 2, 0.4, { GI: 12, GR: 6, GC: 2, GF: 2 }, [2, 1]),
  NLD: C('Niederlande', 'Niederl.', 'amsterdam', '#e6b98a', -1, 3, 0.4, { GI: 6, GR: 4, GG: 1 }, [1, 1]),
  LUX: C('Luxemburg', 'Luxemb.', 'luxemburg', '#cfc9b8', -1, 3, 0, { GG: 1 }),
  DNK: C('Dänemark', 'Dän.', 'kopenhagen', '#d8b0a0', -1, 3, 0.3, { GI: 2, GG: 1 }),
  NOR: C('Norwegen', 'Norw.', 'oslo', '#b0bfd0', -1, 3, 0.3, { GR: 5, GM: 1 }),
  SWE: C('Schweden', 'Schwed.', 'stockholm', '#a9c6da', 0, 1, 0.4, { GI: 8, GR: 4, GA: 1 }, [3, 2]),
  FIN: C('Finnland', 'Finn.', 'helsinki', '#c9d6e2', 1, 2, 0.5, { GI: 12, GR: 3, GC: 1 }, [2, 1]),
  EST: C('Estland', 'Estn.', 'reval', '#bfd0c0', -1, 3, 0.3, { GI: 2, GR: 1 }),
  LAT: C('Lettland', 'Lett.', 'riga', '#c9bfd0', -1, 3, 0.3, { GI: 2, GR: 2 }),
  LIT: C('Litauen', 'Lit.', 'kaunas', '#d6d0a8', -1, 3, 0.3, { GI: 2, GR: 1 }),
  SOV: C('Sowjetunion', 'Sowj.', 'moskau', '#cf9a90', -1, 0, 1, { GI: 80, GR: 20, GM: 5, GC: 8, GO: 10, GA: 18, GG: 6 }, [30, 20]),
  ITA: C('Italien', 'Ital.', 'rom', '#a9c7a6', -1, 2, 0.5, { GI: 30, GR: 8, GM: 5, GO: 3, GA: 3, GC: 1, GG: 4 }, [12, 10], 0.22),
  ALB: C('Albanien', 'Alban.', 'tirana', '#c6b6c6', -1, 3, 0, { GR: 1 }),
  CHE: C('Schweiz', 'Schweiz.', 'bern', '#e0c8c8', 0, 1, 0.4, { GM: 6, GI: 4, GF: 2 }, [2, 0]),
  SPA: C('Spanien', 'Span.', 'madrid', '#e2d28e', -1, 3, 0.3, { GI: 18, GR: 6, GC: 1 }, [3, 2], 0.08),
  POR: C('Portugal', 'Portug.', 'lissabon', '#b7d0a0', -1, 3, 0.3, { GI: 4, GR: 2 }),
  HUN: C('Ungarn', 'Ungar.', 'budapest', '#c7b08c', -1, 2, 0.5, { GI: 9, GO: 2, GC: 2, GM: 1 }, [2, 1]),
  ROM: C('Rumänien', 'Rumän.', 'bukarest', '#d9cf8f', -1, 3, 0.5, { GI: 15, GC: 4, GM: 3, GA: 1 }, [3, 2]),
  BUL: C('Bulgarien', 'Bulgar.', 'sofia', '#b8c09a', -1, 3, 0.4, { GI: 8, GC: 1 }, [1, 1]),
  YUG: C('Jugoslawien', 'Jugosl.', 'belgrad', '#bcb0d0', -1, 3, 0.4, { GI: 14, GR: 8, GC: 3, GM: 2 }, [3, 2]),
  GRC: C('Griechenland', 'Griech.', 'athen', '#a8cfd6', 0, 3, 0.4, { GI: 9, GM: 5, GR: 3 }, [1, 1]),
  TUR: C('Türkei', 'Türk.', 'ankara', '#c0d6b0', -1, 3, 0.4, { GI: 18, GC: 3, GM: 3 }, [3, 2]),
  IRQ: C('Irak', 'Irak.', 'bagdad', '#d6ccb0', -1, 3, 0, { GR: 3 }),
  PER: C('Iran', 'Iran.', '', '#cfc0a8', -1, 3, 0, { GR: 3, GC: 1 }),
  SAU: C('Saudi-Arabien', 'Saud.', '', '#ddd3b3', -1, 3, 0, { GC: 2 }),
};

/** Farbe der Truppenzähler: Achse grünlich, Gegner nach Staat. */
export const UNIT_COLOR: Record<string, string> = {
  GER: '#7d8672', ITA: '#9fb08a', HUN: '#a3a886', ROM: '#a3a886', BUL: '#a3a886', FIN: '#b9c4cf', SVK: '#a3a886',
  SOV: '#c8685a', ENG: '#c99a84', USA: '#8fae7a', FRA: '#7f9ccb', POL: '#c9a24b',
};

// ---- Forschung ------------------------------------------------------------

export interface Tech { id: string; name: string; group: string; year: number; cost: number; req?: string; text: string }
export const TECHS: Record<string, Tech> = {};
const START = ['inf0', 'kfz0', 'art0', 'pak0', 'pzl0', 'jg0', 'bo0'];
for (const cat of Object.keys(MODELS) as Cat[])
  MODELS[cat].forEach((m, i) => {
    const id = `${cat}${i}`;
    if (START.includes(id)) return;
    TECHS[id] = {
      id, name: m.name, group: cat, year: m.year, cost: 900 + 260 * Math.max(0, m.year - 1935) + (cat === 'pzs' ? 700 : 0),
      req: i > 0 ? `${cat}${i - 1}` : undefined, text: 'Neues Muster für die Fertigung',
    };
  });
const X = (id: string, name: string, year: number, cost: number, text: string, req?: string) => (TECHS[id] = { id, name, group: 'x', year, cost, req, text });
X('ind1', 'Vierjahresplan', 1936, 1400, '+6 % Industriekapazität');
X('ind2', 'Rationalisierung der Fertigung', 1939, 2200, '+6 % Industriekapazität', 'ind1');
X('ind3', 'Zentrale Rüstungsplanung', 1942, 3000, '+8 % Industriekapazität', 'ind2');
X('syn1', 'Kohlehydrierung', 1936, 1300, '+3 Öl je Tag');
X('syn2', 'Ausbau der Hydrierwerke', 1938, 1900, '+3 Öl je Tag', 'syn1');
X('syn3', 'Fischer-Tropsch-Großanlagen', 1940, 2600, '+4 Öl je Tag', 'syn2');
X('log1', 'Feldeisenbahn und Kraftwagen-Transportregimenter', 1938, 1500, '+2 Reichweite des Nachschubs');
X('log2', 'Umspurung und Großtransportraum', 1941, 2400, '+2 Reichweite des Nachschubs', 'log1');
export const START_TECH = START;

// ---- Deutsche Ausgangslage am 1. Januar 1936 ------------------------------
// Standorte der Wehrkreise: [Name, Schablone, Breite, Länge]
export const GER_OOB: [string, string, number, number][] = [
  ['1. Infanterie-Division', 'ID36', 54.71, 20.51], ['11. Infanterie-Division', 'ID36', 53.78, 20.48], ['21. Infanterie-Division', 'ID36', 54.16, 19.4],
  ['2. Infanterie-Division', 'ID36', 53.43, 14.55], ['12. Infanterie-Division', 'ID36', 53.63, 11.41], ['32. Infanterie-Division', 'ID36', 54.19, 16.18],
  ['3. Infanterie-Division', 'ID36', 52.34, 14.55], ['23. Infanterie-Division', 'ID36', 52.4, 13.06], ['4. Infanterie-Division', 'ID36', 51.05, 13.74],
  ['14. Infanterie-Division', 'ID36', 51.34, 12.37], ['24. Infanterie-Division', 'ID36', 50.83, 12.92], ['5. Infanterie-Division', 'ID36', 48.4, 9.99],
  ['25. Infanterie-Division', 'ID36', 48.9, 9.19], ['35. Infanterie-Division', 'ID36', 49.01, 8.4], ['6. Infanterie-Division', 'ID36', 52.02, 8.53],
  ['16. Infanterie-Division', 'ID36', 51.96, 7.63], ['26. Infanterie-Division', 'ID36', 50.94, 6.96], ['7. Infanterie-Division', 'ID36', 48.14, 11.58],
  ['17. Infanterie-Division', 'ID36', 49.45, 11.08], ['27. Infanterie-Division', 'ID36', 48.37, 10.9], ['8. Infanterie-Division', 'ID36', 50.67, 17.92],
  ['18. Infanterie-Division', 'ID36', 51.21, 16.16], ['28. Infanterie-Division', 'ID36', 51.11, 17.03], ['9. Infanterie-Division', 'ID36', 50.58, 8.67],
  ['19. Infanterie-Division', 'ID36', 52.37, 9.73], ['29. Infanterie-Division', 'ID36', 50.98, 11.03], ['20. Infanterie-Division', 'ID36', 53.55, 10.0],
  ['22. Infanterie-Division', 'ID36', 53.08, 8.8], ['30. Infanterie-Division', 'ID36', 53.87, 10.69], ['31. Infanterie-Division', 'ID36', 52.27, 10.52],
  ['1. Panzer-Division', 'PZD36', 50.98, 11.33], ['2. Panzer-Division', 'PZD36', 49.79, 9.94], ['3. Panzer-Division', 'PZD36', 52.52, 13.4],
  ['Gebirgs-Brigade', 'GEBB', 47.5, 11.1], ['1. Kavallerie-Brigade', 'KAVB', 54.63, 21.8],
];
/** Gliederungen, die der Spieler aufstellen kann, und der Namensstamm für die Zählung. */
export const GER_BUILD: [string, string][] = [
  ['ID1', 'Infanterie-Division'], ['ID2', 'Infanterie-Division'], ['ID3', 'Infanterie-Division'], ['GEBD', 'Gebirgs-Division'],
  ['IDM', 'Infanterie-Division (mot.)'], ['LEI', 'leichte Division'], ['PZD36', 'Panzer-Division'], ['PZD', 'Panzer-Division'],
  ['PZD41', 'Panzer-Division'], ['SPZ', 'schwere Panzer-Abteilung'], ['BRIG', 'Festungs-Brigade'],
];
