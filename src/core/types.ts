// Gemeinsame Typen. Alles unter src/core und src/data ist frei von DOM-Zugriffen,
// damit die Spiellogik auch headless (Tests, Auto-Resolve, spätere Desktop-App) läuft.

// Im Europa-Szenario steht 'GER' für die Achse und 'POL' für alle Kriegsgegner des Reichs;
// welcher Staat dahintersteht, sagt Division.nation bzw. EuState.owner.
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
  // nur Europakarte
  sea?: string; // angrenzende Seegebiete: N Nordsee/Atlantik, B Ostsee, M Mittelmeer, S Schwarzes Meer
  port?: boolean;
  ind?: number; // Industriekapazität
  steel?: number;
  oil?: number;
  infra?: number; // Nachschubkosten je Schritt (1 gut ausgebaut … 2 schlecht)
  flags?: string;
  ll?: [number, number]; // Breite, Länge des Hauptorts
}

export type UnitTypeId = string;

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
  cat?: string; // Waffengattung (Produktionslinie)
  lvl?: number; // Generation innerhalb der Gattung
  base?: string; // Platzhalter in den Divisionsschablonen
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
  arm?: number; // Armee, der der Verband angehört
  xp?: number; // Erfahrung 0–130; ohne Angabe gilt der Verband als ausgebildet
  ctl?: boolean; // Verband eines Verbündeten, der dem Spieler unterstellt ist
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
  follow?: string | null; // rückt nach den Schlachten in diese eigene Provinz nach, sobald dort Platz frei wird
  oos: boolean; // abgeschnitten
  done?: boolean; // setzt diese Runde aus
  low?: boolean; // am Ende der Nachschublinie: kein Ersatz, geringere Kampfkraft
  sea?: boolean; // der vorgemerkte Angriff ist eine Landung über See
  seaZ?: string; // Seegebiet der Überfahrt (belegt dort eine Transportflotte)
}

export interface GameState {
  turn: number;
  player: Side;
  ctrl: Record<string, Owner>;
  divs: Division[];
  log: string[];
  over: { winner: Side; text: string } | null;
  seed: number;
  air: AirForce; // vorhandene Jagd- und Bomberstaffeln
  airAssign: Record<Side, Record<string, { f: number; b: number }>>; // Zuteilung je Sektor (Provinz samt Nachbarn)
  asked?: boolean; // Rückfrage „alle gezogen“ in dieser Runde schon gestellt
  airQ?: Record<Side, { f: number; b: number }>; // Güte der Flugzeugmuster (Europa)
  eu?: EuState; // nur im Europa-Szenario
}

export type Rel = 'A' | 'E' | 'N'; // Achse, Kriegsgegner, neutral

export interface News { id?: string; title: string; text: string; yes?: string; no?: string }

export interface Build { kind: string; name: string; prov: string; day: number; got: (string | null)[] }

export interface Eco {
  ik: number; ikHome: number; ikOcc: number;
  lock?: Record<string, number>; // gesperrte Posten: fester Anteil an der Industrie (0–1), unabhängig von den übrigen Reglern
  w: Record<string, number>; // Regler: Anteile der Industrie (res, sup und je Waffengattung)
  steel: number; oil: number; men: number; sup: number;
  rate: Record<string, number>; // Zu- und Abgänge je Tag in der letzten Runde (Anzeige)
  lines: Record<string, { lvl: number; eff: number }>; // Fertigungslinie je Gattung; lvl −1 = noch kein Muster
  neu: Record<string, number>; // Lager für Neuaufstellungen, Schlüssel "Gattung:Generation"
  upg: Record<string, number>; // Lager für die Umrüstung bestehender Einheiten
  rep: Record<string, number>; // Lager für den Ersatz von Verlusten (Verstärkung)
  use: { neu: number; upg: number; rep: number }; // Verwendung der Fertigung in Prozent, zusammen 100
  acc: Record<string, number>; // angefangene Flugzeugstaffeln
  queue: Build[];
  auto: boolean; // Neuaufstellungen selbsttätig in Auftrag geben
  done: string[]; // abgeschlossene Forschung
  prog: Record<string, number>;
  slots: (string | null)[];
  airF: number[]; airB: number[]; airS: number[]; // Staffeln je Generation: Jäger, Bomber, strategische Bomber
  dmg?: number; // zerstörte IK im eigenen Gebiet (Summe)
  num: Record<string, number>; // laufende Nummern für Verbandsnamen
  short: string[]; // Mangel in der letzten Runde
  fac: number; // zusätzlich gebaute Industrie (IK)
  plants: number; // Hydrierwerke (Kohle → Öl)
  tank: number; // Fassungsvermögen der Tanklager
  coal: number; // Kohleförderung der eigenen Reviere je Tag
  exp: number; // Industrie, die für die Ausfuhr arbeitet (bezahlt den Öleinkauf)
  trade: Record<string, number>; // vereinbarte Ölmengen je Tag und Handelspartner
}

export interface Ships { tr: number; ub: number; dd: number; bb: number; cv: number }
export interface Army { id: number; name: string; gen: string | null; nation?: string } // nation: Armee einer KI-Macht, sonst des Spielers

export interface NavyState {
  own: Record<string, Ships>; // deutsche Flotte je Seegebiet, 'H' = im Hafen
  other: Record<string, Ships>; // Flotten der übrigen Staaten
  yard: { k: keyof Ships; name: string; prog: number }[]; // Werftaufträge, älteste zuerst
  used: Record<string, number>;
  sunk: number; lostUb: number; // Bilanz des Handelskriegs
  airT: number; // Staffeln Trägerflugzeuge
  num?: Record<string, number>;
}

export interface EuState {
  navy?: NavyState;
  armies?: Army[]; armyNo?: number;
  gens?: Record<string, { rank: number; wins: number }>; // Rang und Siege der Generäle seit der letzten Beförderung
  bomb?: Record<string, number>; // eigene strategische Bomber je Zielprovinz
  raid?: Record<string, number>; // feindliche Bomber der letzten Runde je getroffener Provinz
  dmg?: Record<string, number>; // durch Bomben zerstörte IK je Provinz
  sbN?: Record<string, number>; // strategische Bomber der Gegner
  day: number; // Tage seit dem 1. Januar 1936
  owner: Record<string, string>; // Provinz → Staat
  rel: Record<string, Rel>;
  gone: string[]; // untergegangene Staaten
  flags: Record<string, number>; // Ereignis oder Merker → Tag
  news: News[];
  pts: Record<string, number>; // Aufbaupunkte der KI-Staaten
  airN: Record<string, { f: number; b: number }>; // Luftstreitkräfte der übrigen Staaten
  core: Record<string, 1>; // Reichsgebiet (volle Industrie, Nachschubquelle)
  eco: Eco;
}

export type AirForce = Record<Side, { f: number; b: number }>;

export const other = (s: Side): Side => (s === 'GER' ? 'POL' : 'GER');
