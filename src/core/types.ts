// Gemeinsame Typen. Alles unter src/core und src/data ist frei von DOM-Zugriffen,
// damit die Spiellogik auch headless (Tests, Auto-Resolve, spätere Desktop-App) läuft.

export type Side = 'GER' | 'POL';
export type Owner = Side | 'NEU';
export type Terrain = 'p' | 'f' | 'h' | 'm' | 's' | 'u';

export interface Province {
  id: string;
  name: string;
  x: number;
  y: number;
  poly: number[];
  adj: string[];
  country: string;
  side0: Owner;
  terrain: Terrain;
  vp: number;
  supply: boolean;
  capital: boolean;
  river: boolean;
}

export type UnitTypeId =
  | 'INF' | 'RES' | 'GEB' | 'MOT' | 'CAV' | 'ENG' | 'AT' | 'REC'
  | 'ARTL' | 'ARTH' | 'PZL' | 'PZM' | 'TKS' | 'TP7';

export type MoveType = 'foot' | 'horse' | 'wheel' | 'track';

export interface UnitType {
  id: UnitTypeId;
  name: Record<Side, string>;
  sym: 'inf' | 'mot' | 'cav' | 'arm' | 'art' | 'at' | 'rec' | 'eng' | 'mtn';
  sa: number; // Angriff gegen weiche Ziele
  ha: number; // Angriff gegen gepanzerte Ziele
  def: number;
  mp: number; // Bewegungspunkte auf der Schlachtkarte
  move: MoveType;
  rng: number; // >1 = Artillerie
  ini: number;
  hard: boolean;
}

export interface UnitState {
  t: UnitTypeId;
  s: number; // Stärke 0..10
}

export interface Division {
  id: number;
  name: string;
  side: Side;
  nation: string;
  kind: string; // Schablone
  army: string;
  q: number; // Qualität -1..+2
  prov: string;
  units: UnitState[];
  mp: number;
  dug: number; // Eingrabung 0..3
  fought: boolean;
  moved: boolean;
  order: string | null; // Angriffsziel (Provinz-ID)
  oos: boolean; // abgeschnitten
}

export interface GameState {
  turn: number;
  player: Side;
  ctrl: Record<string, Owner>;
  divs: Division[];
  log: string[];
  over: { winner: Side; text: string } | null;
  seed: number;
}

export const other = (s: Side): Side => (s === 'GER' ? 'POL' : 'GER');
