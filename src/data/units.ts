import type { UnitType, UnitTypeId } from '../core/types';

// Platzhalterwerte. Später sollen sie per Formel aus realen technischen Daten
// (Kaliber, Panzerung, Motorleistung, Sollstärke) abgeleitet werden.
const T = (
  id: UnitTypeId, ger: string, pol: string, sym: UnitType['sym'],
  sa: number, ha: number, def: number, mp: number, move: UnitType['move'], rng: number, ini: number, hard = false,
): UnitType => ({ id, name: { GER: ger, POL: pol }, sym, sa, ha, def, mp, move, rng, ini, hard });

export const TYPES: Record<string, UnitType> = {
  INF: T('INF', 'Infanterie-Regiment', 'Pułk Piechoty', 'inf', 6, 2, 6, 3, 'foot', 1, 2),
  RES: T('RES', 'Landwehr-Regiment', 'Pułk Piechoty (rez.)', 'inf', 5, 1, 5, 3, 'foot', 1, 1),
  GEB: T('GEB', 'Gebirgsjäger-Regiment', 'Pułk Strzelców Podhalańskich', 'mtn', 7, 2, 7, 3, 'foot', 1, 3),
  MOT: T('MOT', 'Schützen-Regiment (mot.)', 'Pułk Strzelców (zmot.)', 'mot', 7, 3, 6, 6, 'wheel', 1, 3),
  CAV: T('CAV', 'Reiter-Regiment', 'Pułk Ułanów', 'cav', 5, 2, 4, 5, 'horse', 1, 3),
  ENG: T('ENG', 'Pionier-Bataillon', 'Batalion Saperów', 'eng', 6, 3, 6, 3, 'foot', 1, 2),
  AT: T('AT', 'Panzerabwehr-Abteilung (3,7 cm)', 'Kompanie ppanc. (37 mm Bofors)', 'at', 2, 7, 4, 3, 'foot', 1, 4),
  REC: T('REC', 'Aufklärungs-Abteilung', 'Dywizjon Rozpoznawczy', 'rec', 4, 3, 3, 7, 'wheel', 1, 4),
  FLAK: T('FLAK', 'Flak-Abteilung (2 cm Flak 30)', 'Bateria Przeciwlotnicza', 'aa', 3, 2, 4, 3, 'foot', 1, 3),
  ARTL: T('ARTL', 'Artillerie-Abt. (10,5 cm leFH 18)', 'Pułk Artylerii Lekkiej (75 mm)', 'art', 7, 2, 2, 3, 'foot', 3, 1),
  ARTH: T('ARTH', 'Schwere Art.-Abt. (15 cm sFH 18)', 'Dywizjon Art. Ciężkiej (155 mm)', 'art', 9, 3, 2, 2, 'foot', 4, 1),
  PZL: T('PZL', 'Panzer-Regiment (Pz I/II)', 'Batalion Czołgów Lekkich', 'arm', 8, 5, 7, 5, 'track', 1, 5, true),
  PZM: T('PZM', 'Panzer-Abteilung (Pz III/IV)', 'Batalion Czołgów', 'arm', 9, 9, 9, 5, 'track', 1, 6, true),
  TKS: T('TKS', 'Panzerspäh-Abteilung', 'Dywizjon Pancerny (TKS, wz. 34)', 'arm', 5, 3, 4, 5, 'track', 1, 3, true),
  TP7: T('TP7', 'Panzer-Abteilung', 'Batalion Czołgów Lekkich (7TP)', 'arm', 7, 8, 7, 5, 'track', 1, 5, true),
};

// ---- Europa 1936: Waffengattungen und ihre Generationen --------------------
// Jede Generation ist ein eigener Einheitentyp; Umrüsten heißt, den Typ eines Bataillons zu wechseln.
// Alle Werte sind eigene Platzhalter, grob nach Kaliber, Panzerung und Baujahr gestaffelt.

export type Cat = 'inf' | 'kfz' | 'art' | 'pak' | 'flak' | 'pzl' | 'pzm' | 'pzs' | 'jg' | 'bo' | 'sb';
export const CATS: Record<Cat, string> = {
  inf: 'Infanteriewaffen', kfz: 'Kraftfahrzeuge', art: 'Artillerie', pak: 'Panzerabwehr', flak: 'Flugabwehr',
  pzl: 'Leichte Panzer', pzm: 'Mittlere Panzer', pzs: 'Schwere Panzer', jg: 'Jagdflugzeuge', bo: 'Bomber', sb: 'Strategische Bomber',
};
export const GROUND: Cat[] = ['inf', 'kfz', 'art', 'pak', 'flak', 'pzl', 'pzm', 'pzs'];
/** Flak im Gefecht: Chance je Generation, einen Angriff taktischer Bomber auf das eigene oder ein Nachbarfeld abzuwehren. */
export const FLAK_HIT = [0.25, 0.35, 0.5];

/** Deutsche Muster je Gattung. cost = Industrietage je Stärkepunkt (Flugzeuge: je Staffel), q = Güte im Luftkampf. */
export interface Model { name: string; year: number; cost: number; q?: number }
export const MODELS: Record<Cat, Model[]> = {
  inf: [{ name: 'Karabiner 98k / MG 34', year: 1935, cost: 8 }, { name: 'MG 42 / MP 40', year: 1941, cost: 9 }, { name: 'Sturmgewehr 44 / Panzerfaust', year: 1943, cost: 10 }],
  kfz: [{ name: 'Lkw / Sd.Kfz. 221', year: 1935, cost: 18 }, { name: 'Schützenpanzer Sd.Kfz. 251', year: 1939, cost: 21 }, { name: 'Sd.Kfz. 251 D / Sd.Kfz. 234', year: 1943, cost: 24 }],
  art: [{ name: '10,5 cm leFH 18', year: 1935, cost: 16 }, { name: 'leFH 18 M / sFH 18', year: 1940, cost: 18 }, { name: 'leFH 18/40 / Nebelwerfer', year: 1942, cost: 20 }],
  pak: [{ name: '3,7 cm Pak 36', year: 1935, cost: 12 }, { name: '5 cm Pak 38', year: 1940, cost: 14 }, { name: '7,5 cm Pak 40', year: 1941, cost: 16 }, { name: '8,8 cm Pak 43', year: 1943, cost: 19 }],
  // Flugabwehr ist zu Beginn nicht vorhanden und muss erst erforscht werden
  flak: [{ name: '2 cm Flak 30', year: 1935, cost: 13 }, { name: '3,7 cm Flak 36', year: 1937, cost: 15 }, { name: '8,8 cm Flak 36', year: 1939, cost: 19 }],
  pzl: [{ name: 'Panzer I', year: 1934, cost: 26 }, { name: 'Panzer II', year: 1936, cost: 30 }, { name: 'Panzer 38(t)', year: 1939, cost: 34 }],
  pzm: [{ name: 'Panzer III (3,7 cm)', year: 1937, cost: 50 }, { name: 'Panzer IV (7,5 cm kurz)', year: 1938, cost: 55 }, { name: 'Panzer III (5 cm)', year: 1940, cost: 58 }, { name: 'Panzer IV (7,5 cm lang)', year: 1942, cost: 64 }, { name: 'Panther', year: 1943, cost: 80 }],
  pzs: [{ name: 'Tiger', year: 1942, cost: 110 }, { name: 'Königstiger', year: 1944, cost: 130 }],
  // Jäger sind billig: Der Kampf um die Lufthoheit verschleißt sie schnell
  jg: [{ name: 'Heinkel He 51', year: 1934, cost: 120, q: 0.8 }, { name: 'Bf 109 B/D', year: 1937, cost: 135, q: 1 }, { name: 'Bf 109 E', year: 1939, cost: 150, q: 1.2 }, { name: 'Bf 109 F / Fw 190 A', year: 1941, cost: 165, q: 1.4 }, { name: 'Bf 109 G', year: 1942, cost: 175, q: 1.5 }, { name: 'Me 262', year: 1944, cost: 240, q: 2 }],
  sb: [{ name: 'Do 19 / Ju 89 „Uralbomber“', year: 1937, cost: 520, q: 0.8 }, { name: 'Fw 200 C „Condor“', year: 1940, cost: 560, q: 1 }, { name: 'He 177 „Greif“', year: 1942, cost: 640, q: 1.3 }],
  bo: [{ name: 'Ju 52 / Do 23', year: 1934, cost: 300, q: 0.7 }, { name: 'He 111 / Do 17', year: 1936, cost: 340, q: 1 }, { name: 'Ju 87 „Stuka“', year: 1937, cost: 320, q: 1.15 }, { name: 'Ju 88', year: 1939, cost: 380, q: 1.3 }, { name: 'Do 217 / Fw 190 F', year: 1942, cost: 420, q: 1.45 }],
};
/** Musternamen der spielbaren Staaten neben dem Reich; Jahre, Kosten und Werte folgen derselben Stufenleiter. */
export const NATION_MODELS: Record<string, Record<Cat, string[]>> = {
  USA: {
    inf: ['Springfield M1903 / BAR', 'M1 Garand / M1919', 'M1 Carbine / Bazooka'],
    kfz: ['Lkw 1½ t / M3 Scout Car', 'GMC CCKW 2½ t / Jeep', 'Halbkette M3 / M8 Greyhound'],
    art: ['75-mm-Feldkanone M1897', '105-mm-Haubitze M2', '155-mm-Haubitze M1'],
    pak: ['37 mm M3', '57 mm M1', '3 inch M5', '90 mm M36'],
    flak: ['M2 Kaliber .50 / 37 mm M1', '40 mm Bofors M1', '90 mm M1'],
    pzl: ['M1 Combat Car', 'M2 Light Tank', 'M3 / M5 Stuart'],
    pzm: ['M2 Medium', 'M3 Lee', 'M4 Sherman (75 mm)', 'M4A3 Sherman (76 mm)', 'M4A3E8 „Easy Eight“'],
    pzs: ['M6 Heavy', 'M26 Pershing'],
    jg: ['Boeing P-26', 'Curtiss P-36', 'Curtiss P-40', 'Lockheed P-38', 'Republic P-47', 'North American P-51 D'],
    bo: ['Martin B-10', 'Douglas B-18', 'Douglas A-20', 'North American B-25', 'Martin B-26 / A-26'],
    sb: ['Boeing B-17', 'Consolidated B-24', 'Boeing B-29'],
  },
  SOV: {
    inf: ['Mosin-Nagant / DP-27', 'SWT-40 / PPSch-41', 'PPS-43 / Goryunow SG-43'],
    kfz: ['GAZ-AA / BA-10', 'ZIS-5 / BA-64', 'Studebaker US6 / SU-76'],
    art: ['76-mm-Kanone M1902/30', '122-mm-Haubitze M-30', '152-mm-Haubitze ML-20 / Katjuscha'],
    pak: ['45 mm M1937', '57 mm ZIS-2', '76 mm ZIS-3', '100 mm BS-3'],
    flak: ['Maxim-Vierling / 25 mm 72-K', '37 mm 61-K', '85 mm 52-K'],
    pzl: ['T-26', 'BT-7', 'T-70'],
    pzm: ['T-28', 'T-34 (Modell 1940)', 'T-34/76', 'T-34/85', 'T-44'],
    pzs: ['KW-1', 'IS-2'],
    jg: ['Polikarpow I-15', 'Polikarpow I-16', 'MiG-3 / LaGG-3', 'Jak-1 / La-5', 'Jak-9', 'La-7 / Jak-3'],
    bo: ['Tupolew TB-3', 'Tupolew SB', 'Iljuschin Il-2', 'Petljakow Pe-2', 'Tupolew Tu-2 / Il-10'],
    sb: ['Iljuschin DB-3', 'Iljuschin Il-4', 'Petljakow Pe-8'],
  },
  ENG: {
    inf: ['Lee-Enfield No. 1 / Lewis', 'Lee-Enfield No. 4 / Bren', 'Sten / PIAT'],
    kfz: ['Morris 15 cwt / Rolls-Royce', 'Bedford QL / Universal Carrier', 'M3-Halbkette / Daimler'],
    art: ['18-Pfünder', '25-Pfünder', '5,5-Zoll-Kanone'],
    pak: ['2-Pfünder', '6-Pfünder', '17-Pfünder', '17-Pfünder APDS'],
    flak: ['3 Zoll 20 cwt', '40 mm Bofors', '3,7 Zoll QF'],
    pzl: ['Light Tank Mk VI', 'Tetrarch', 'Stuart „Honey“'],
    pzm: ['Cruiser Mk IV (A13)', 'Matilda II', 'Crusader', 'Cromwell', 'Comet'],
    pzs: ['Churchill', 'Churchill Mk VII'],
    jg: ['Gloster Gladiator', 'Hawker Hurricane', 'Spitfire Mk I/II', 'Spitfire Mk V', 'Spitfire Mk IX', 'Hawker Tempest'],
    bo: ['Fairey Battle', 'Bristol Blenheim', 'Vickers Wellington', 'De Havilland Mosquito', 'Hawker Typhoon'],
    sb: ['Armstrong Whitworth Whitley', 'Handley Page Halifax', 'Avro Lancaster'],
  },
  FRA: {
    inf: ['Lebel / Berthier, FM 24/29', 'MAS 36 / Hotchkiss', 'MAS 40 / MAS 38'],
    kfz: ['Laffly / Panhard 165', 'Lorraine 38L / Panhard 178', 'Laffly W15 / Panhard 201'],
    art: ['Canon de 75 modèle 1897', 'Canon de 105 court modèle 1935', 'Canon de 155 GPF-T'],
    pak: ['25 mm SA 34', '47 mm SA 37', '75 mm TAZ 39', '90 mm CA 39'],
    flak: ['13,2 mm Hotchkiss / 25 mm CA 38', '25 mm CA 39 / 40 mm Bofors', '75 mm CA 32'],
    pzl: ['Renault FT / AMR 33', 'Renault R35', 'Hotchkiss H39'],
    pzm: ['Char D2', 'SOMUA S35', 'SOMUA S40', 'Char G1', 'ARL 44'],
    pzs: ['Char B1 bis', 'ARL 44 (schwer)'],
    jg: ['Dewoitine D.510', 'Morane-Saulnier MS.406', 'Bloch MB.152', 'Dewoitine D.520', 'Arsenal VG-33', 'Dewoitine D.551'],
    bo: ['Bloch MB.200', 'Potez 63', 'Lioré-et-Olivier LeO 451', 'Amiot 354', 'Breguet 693'],
    sb: ['Farman F.222', 'Bloch MB.162', 'Bloch MB.162 (Serie)'],
  },
  ITA: {
    inf: ['Carcano M91 / Breda 30', 'Carcano M38 / Breda 37', 'Beretta MAB 38'],
    kfz: ['Fiat 508 / Lancia 1ZM', 'Fiat-SPA TL37 / AB 41', 'Fiat 626 / AB 43'],
    art: ['Cannone da 75/27', 'Obice da 75/18', 'Cannone da 149/40'],
    pak: ['47/32 „Elefantino“', '47/40', '75/32', '90/53'],
    flak: ['Breda 20/65', 'Breda 37/54', 'Cannone da 90/53'],
    pzl: ['CV 33 (L3)', 'L6/40', 'Semovente 47/32'],
    pzm: ['M11/39', 'M13/40', 'M14/41', 'M15/42', 'P26/40'],
    pzs: ['Semovente 90/53', 'P26/40 (schwer)'],
    jg: ['Fiat CR.32', 'Fiat CR.42', 'Macchi C.200', 'Macchi C.202', 'Macchi C.205', 'Fiat G.55'],
    bo: ['Savoia-Marchetti SM.81', 'Savoia-Marchetti SM.79', 'Fiat BR.20', 'CANT Z.1007', 'Savoia-Marchetti SM.84'],
    sb: ['Piaggio P.32', 'Piaggio P.108', 'Piaggio P.108 B'],
  },
  JAP: {
    inf: ['Arisaka Typ 38 / Typ 11', 'Arisaka Typ 99 / Typ 96', 'Typ 100 / Typ 99'],
    kfz: ['Isuzu Typ 94 / Typ 92', 'Toyota KB / Typ 1 Ho-Ha', 'Typ 1 Ho-Ki / Typ 4 Ka-Tsu'],
    art: ['75-mm-Feldkanone Typ 38', '105-mm-Haubitze Typ 91', '150-mm-Haubitze Typ 96'],
    pak: ['37 mm Typ 94', '47 mm Typ 1', '75 mm Typ 90', '75 mm Typ 5 (Na-To)'],
    flak: ['20 mm Typ 98', '25 mm Typ 96', '75 mm Typ 88'],
    pzl: ['Typ 94 Te-Ke', 'Typ 95 Ha-Go', 'Typ 98 Ke-Ni'],
    pzm: ['Typ 89 I-Go', 'Typ 97 Chi-Ha', 'Typ 97 Shinhōtō Chi-Ha', 'Typ 1 Chi-He', 'Typ 3 Chi-Nu'],
    pzs: ['Typ 4 Chi-To', 'Typ 5 Chi-Ri'],
    jg: ['Kawasaki Ki-10 / Mitsubishi A5M', 'Nakajima Ki-27', 'Mitsubishi A6M „Zero“ / Ki-43', 'Kawasaki Ki-61 Hien', 'Nakajima Ki-84 Hayate', 'Kawanishi N1K2 Shiden-Kai'],
    bo: ['Mitsubishi Ki-2', 'Mitsubishi Ki-21', 'Kawasaki Ki-48', 'Nakajima Ki-49 Donryū', 'Mitsubishi Ki-67 Hiryū'],
    sb: ['Mitsubishi G3M', 'Mitsubishi G4M', 'Nakajima G8N Renzan'],
  },
  // Chinas Ausrüstung kommt nacheinander aus Deutschland, der Sowjetunion und den Vereinigten Staaten
  CHI: {
    inf: ['Hanyang 88 / ZB vz. 26', 'Tschiang-Kai-schek-Gewehr / Maxim Typ 24', 'M1 Garand / Thompson'],
    kfz: ['Dodge-Lkw / Leichter Panzerwagen', 'GAZ-AA / BA-10', 'GMC CCKW / M3 Scout Car'],
    art: ['75-mm-Gebirgskanone Krupp', '15-cm-Feldhaubitze 18', '105-mm-Haubitze M2'],
    pak: ['3,7-cm-PaK 36', '45 mm M1937', '57 mm M1', '3 inch M5'],
    flak: ['2 cm Flak 30 / Solothurn', '37 mm 61-K', '40 mm Bofors'],
    pzl: ['Vickers 6-Tonner / Panzer I', 'T-26', 'M3 Stuart'],
    pzm: ['Vickers 6-Tonner Typ B', 'T-26 (200. Division)', 'M3 Lee', 'M4 Sherman', 'M4A4 Sherman'],
    pzs: ['M4 Sherman (105 mm)', 'M26 Pershing'],
    jg: ['Curtiss Hawk III', 'Polikarpow I-15bis', 'Polikarpow I-16', 'Curtiss P-40', 'Republic P-43 / P-40N', 'North American P-51'],
    bo: ['Northrop Gamma 2E', 'Tupolew SB', 'Lockheed A-29 Hudson', 'North American B-25', 'North American B-25J'],
    sb: ['Martin 139', 'Iljuschin DB-3', 'Consolidated B-24'],
  },
};
/** Name eines Musters beim jeweiligen Staat. */
/** Bezeichnung eines Bataillons mit dem Muster seines Staates, etwa „Infanterie-Regiment (Lee-Enfield No. 4 / Bren)“. */
export function unitLabel(nation: string, t: string, side: 'GER' | 'POL'): string {
  const ty = TYPES[t], own = NATION_MODELS[nation]?.[ty.cat as Cat]?.[ty.lvl ?? 0];
  return own ? `${ty.name[side].split(' (')[0]} (${own})` : ty.name[side];
}
export const modelName = (nation: string, cat: Cat, lvl: number) => NATION_MODELS[nation]?.[cat]?.[lvl] ?? MODELS[cat][lvl]?.name ?? '';

/** Jahr, ab dem die übrigen Staaten eine Generation führen (zuzüglich ihres Rückstands). */
export const GEN_YEAR: Record<string, number[]> = {
  inf: [1930, 1941, 1943], kfz: [1930, 1940, 1943], art: [1930, 1940, 1942], pak: [1930, 1940, 1942, 1943], flak: [1936, 1939, 1941],
  pzl: [1930, 1936, 1939], pzm: [1937, 1939, 1941, 1942, 1944], pzs: [1940, 1944],
};

// Generationsleitern: Platzhalter der Schablonen → Typen in aufsteigender Güte
const LAD_GER: Record<string, string[]> = {}, LAD_GEN: Record<string, string[]> = {};
const BASE_CAT: Record<string, Cat> = { INF: 'inf', RES: 'inf', GEB: 'inf', CAV: 'inf', ENG: 'inf', MOT: 'kfz', REC: 'kfz', ARTL: 'art', ARTH: 'art', AT: 'pak', FLAK: 'flak' };
const BONUS: Record<string, [number, number, number][]> = {
  inf: [[1, 0, 1], [2, 2, 1]], kfz: [[1, 1, 1], [2, 2, 2]], art: [[1, 0, 0], [2, 1, 0]], pak: [[0, 2, 0], [1, 5, 1], [1, 7, 1]],
  flak: [[1, 1, 0], [2, 6, 1]], // die 8,8 taugt auch gegen Panzer
};
for (const [base, cat] of Object.entries(BASE_CAT)) {
  const b = TYPES[base];
  Object.assign(b, { cat, lvl: 0, base });
  const lad = [base];
  BONUS[cat].forEach(([sa, ha, def], i) => {
    const id = `${base}${i + 2}`, model = MODELS[cat][i + 1].name;
    TYPES[id] = { ...b, id, sa: b.sa + sa, ha: b.ha + ha, def: b.def + def, lvl: i + 1,
      name: { GER: `${b.name.GER.split(' (')[0]} (${model})`, POL: `${b.name.GER.split(' (')[0]} (Stand ${GEN_YEAR[cat][i + 1]})` } };
    lad.push(id);
  });
  LAD_GER[base] = LAD_GEN[base] = lad;
}
const tank = (id: string, base: string, cat: Cat, lvl: number, name: string, sa: number, ha: number, def: number, ini: number, mp = 5) =>
  (TYPES[id] = { id, name: { GER: name, POL: name }, sym: 'arm', sa, ha, def, mp, move: 'track', rng: 1, ini, hard: true, cat, lvl, base });
([
  ['PZ1', 5, 2, 4, 4], ['PZ2', 6, 4, 5, 5], ['PZ38', 7, 7, 6, 5],
] as [string, number, number, number, number][]).forEach(([id, sa, ha, def, ini], i) => tank(id, 'PZL', 'pzl', i, `Panzer-Abteilung (${MODELS.pzl[i].name})`, sa, ha, def, ini));
([
  ['PZ3', 7, 8, 8, 6], ['PZ4', 10, 7, 8, 6], ['PZ3L', 9, 10, 9, 6], ['PZ4L', 10, 13, 10, 6], ['PZ5', 11, 16, 13, 7],
] as [string, number, number, number, number][]).forEach(([id, sa, ha, def, ini], i) => tank(id, 'PZM', 'pzm', i, `Panzer-Abteilung (${MODELS.pzm[i].name})`, sa, ha, def, ini));
tank('PZ6', 'PZS', 'pzs', 0, 'Schwere Panzer-Abteilung (Tiger)', 12, 16, 15, 6, 4);
tank('PZ6B', 'PZS', 'pzs', 1, 'Schwere Panzer-Abteilung (Königstiger)', 13, 19, 18, 6, 4);
([['LT', 'PZL', 'pzl', 'Leichte Panzer', [[5, 3, 4, 4], [6, 5, 5, 5], [7, 7, 6, 5]]],
  ['MT', 'PZM', 'pzm', 'Mittlere Panzer', [[7, 7, 7, 5], [8, 9, 8, 5], [9, 11, 10, 6], [10, 13, 11, 6], [11, 15, 12, 6]]],
  ['HT', 'PZS', 'pzs', 'Schwere Panzer', [[10, 12, 14, 5], [12, 17, 16, 6]]],
] as [string, string, Cat, string, number[][]][]).forEach(([pre, base, cat, name, rows]) =>
  rows.forEach(([sa, ha, def, ini], i) => tank(`${pre}${i + 1}`, base, cat, i, `${name} (Stand ${GEN_YEAR[cat][i]})`, sa, ha, def, ini, cat === 'pzs' ? 4 : 5)));
LAD_GER.PZL = ['PZ1', 'PZ2', 'PZ38']; LAD_GER.PZM = ['PZ3', 'PZ4', 'PZ3L', 'PZ4L', 'PZ5']; LAD_GER.PZS = ['PZ6', 'PZ6B'];
LAD_GEN.PZL = ['LT1', 'LT2', 'LT3']; LAD_GEN.PZM = ['MT1', 'MT2', 'MT3', 'MT4', 'MT5']; LAD_GEN.PZS = ['HT1', 'HT2'];
// die Platzhalter selbst brauchen Gattung und Zeichen (Polen 1939 nutzt PZL und PZM zudem als echte Typen)
Object.assign(TYPES.PZL, { cat: 'pzl', base: 'PZL' });
Object.assign(TYPES.PZM, { cat: 'pzm', base: 'PZM' });
TYPES.PZS = { ...TYPES.PZ6, id: 'PZS', base: 'PZS' };

export const ladder = (nation: string, base: string): string[] => (nation === 'GER' ? LAD_GER : LAD_GEN)[base] ?? [base];
export const baseOf = (t: string) => TYPES[t].base ?? t;
export const catOf = (t: string) => TYPES[baseOf(t)].cat as Cat;
export const stockKey = (t: string) => `${TYPES[t].cat}:${TYPES[t].lvl ?? 0}`;

// Im Europa-Szenario tragen beide Seiten dieselben (deutschen) Typnamen; Polen 1939 behält die polnischen.
const POLISH: Record<string, string> = {};
for (const id of ['INF', 'RES', 'GEB', 'MOT', 'CAV', 'ENG', 'AT', 'REC', 'ARTL', 'ARTH', 'PZL', 'PZM', 'TKS', 'TP7']) POLISH[id] = TYPES[id].name.POL;
export function setTypeNames(europe: boolean) {
  for (const id in POLISH) TYPES[id].name.POL = europe ? TYPES[id].name.GER.replace(/ \((10,5|15|3,7) cm[^)]*\)/, '') : POLISH[id];
}

// Divisionsschablonen: Liste "Typ" oder "Typ:Anfangsstärke".
// mp = Bewegungspunkte auf der Strategiekarte (0 = ortsfest), q = Qualität.
export interface Template { label: string; units: string[]; mp: number; q: number }
export const TEMPLATES: Record<string, Template> = {
  // Deutsches Reich
  ID1: { label: 'Infanterie-Division (1. Welle)', units: ['INF', 'INF', 'INF', 'ARTL', 'ARTH', 'REC', 'AT', 'ENG'], mp: 1, q: 1 },
  ID2: { label: 'Infanterie-Division (2. Welle)', units: ['INF', 'INF', 'INF', 'ARTL', 'AT', 'ENG'], mp: 1, q: 0 },
  ID3: { label: 'Infanterie-Division (3. Welle)', units: ['RES', 'RES', 'RES', 'ARTL', 'AT:7'], mp: 1, q: -1 },
  IDM: { label: 'Infanterie-Division (mot.)', units: ['MOT', 'MOT', 'MOT', 'ARTL', 'ARTH', 'REC', 'AT', 'ENG'], mp: 2, q: 1 },
  PZD: { label: 'Panzer-Division', units: ['PZL', 'PZL', 'PZM', 'MOT', 'MOT', 'ARTL', 'REC', 'AT'], mp: 2, q: 1 },
  PZ10: { label: 'Panzer-Division (in Aufstellung)', units: ['PZL', 'PZL:7', 'MOT', 'ARTL:7', 'REC'], mp: 2, q: 0 },
  PZK: { label: 'Panzer-Verband', units: ['PZL', 'PZM:6', 'MOT', 'MOT', 'ARTL', 'REC'], mp: 2, q: 1 },
  LEI: { label: 'Leichte Division', units: ['PZL', 'MOT', 'MOT', 'ARTL', 'REC', 'AT'], mp: 2, q: 1 },
  LEIM: { label: 'Leichte Division (Pz 35(t)/38(t))', units: ['PZM', 'MOT', 'MOT', 'ARTL', 'REC', 'AT'], mp: 2, q: 1 },
  GEBD: { label: 'Gebirgs-Division', units: ['GEB', 'GEB', 'GEB', 'ARTL', 'REC', 'ENG'], mp: 1, q: 1 },
  KAVB: { label: 'Kavallerie-Brigade', units: ['CAV', 'CAV', 'ARTL:6', 'REC'], mp: 2, q: 1 },
  SSR: { label: 'Mot. Regiment (verstärkt)', units: ['MOT', 'MOT:6', 'REC:6'], mp: 2, q: 0 },
  BRIG: { label: 'Grenzschutz-/Festungsbrigade', units: ['RES', 'RES', 'ARTL:6'], mp: 1, q: -1 },
  EBER: { label: 'Kampfgruppe', units: ['RES', 'RES', 'ARTL:6', 'ENG:6'], mp: 1, q: 0 },
  SVKD: { label: 'Slowakische Division', units: ['RES', 'RES', 'RES', 'ARTL:7'], mp: 1, q: -1 },
  // Polen
  DP: { label: 'Dywizja Piechoty', units: ['INF', 'INF', 'INF', 'ARTL', 'ARTH:5', 'AT'], mp: 1, q: 0 },
  DPR: { label: 'Dywizja Piechoty (rezerwowa)', units: ['RES', 'RES', 'RES', 'ARTL:8', 'AT:6'], mp: 1, q: -1 },
  DPG: { label: 'Dywizja Piechoty Górskiej', units: ['GEB', 'GEB', 'GEB', 'ARTL', 'AT:6'], mp: 1, q: 0 },
  BK: { label: 'Brygada Kawalerii', units: ['CAV', 'CAV', 'CAV', 'ARTL:6', 'TKS:6', 'AT:6'], mp: 2, q: 1 },
  BGOR: { label: 'Brygada Górska', units: ['GEB', 'GEB', 'ARTL:5'], mp: 1, q: 0 },
  BMOT: { label: 'Brygada Kawalerii (zmot.)', units: ['MOT', 'MOT', 'TKS', 'ARTL:5', 'AT'], mp: 2, q: 1 },
  BPM: { label: 'Brygada Pancerno-Motorowa (w organizacji)', units: ['MOT:7', 'MOT:7', 'TKS:7', 'ARTL:4', 'AT:7'], mp: 2, q: 0 },
  GARW: { label: 'Stadtverteidigung', units: ['INF', 'INF', 'RES', 'RES', 'ARTL', 'AT:5'], mp: 0, q: 0 },
  GAR: { label: 'Garnison', units: ['RES', 'RES', 'ARTL:5'], mp: 0, q: -1 },
  LOW: { label: 'Küstenverteidigung', units: ['INF', 'INF', 'RES', 'RES', 'ARTL:5'], mp: 0, q: 0 },
  // Europa 1936: weitere deutsche Gliederungen
  PZD36: { label: 'Panzer-Division (leicht)', units: ['PZL', 'PZL', 'MOT', 'ARTL', 'REC'], mp: 2, q: 1 },
  PZD41: { label: 'Panzer-Division 41', units: ['PZM', 'PZM', 'MOT', 'MOT', 'ARTL', 'REC', 'AT', 'ENG'], mp: 2, q: 1 },
  SPZ: { label: 'Schwere Panzer-Abteilung', units: ['PZS'], mp: 2, q: 1 },
  // Gliederungen mit Flugabwehr an Stelle der Panzerabwehr
  ID1F: { label: 'Infanterie-Division (mit Flak)', units: ['INF', 'INF', 'INF', 'ARTL', 'ARTH', 'REC', 'FLAK', 'ENG'], mp: 1, q: 1 },
  IDMF: { label: 'Infanterie-Division (mot., mit Flak)', units: ['MOT', 'MOT', 'MOT', 'ARTL', 'ARTH', 'REC', 'FLAK', 'ENG'], mp: 2, q: 1 },
  PZDF: { label: 'Panzer-Division 41 (mit Flak)', units: ['PZM', 'PZM', 'MOT', 'MOT', 'ARTL', 'REC', 'FLAK', 'ENG'], mp: 2, q: 1 },
  GIF: { label: 'Infanterie-Division (mit Flak)', units: ['INF', 'INF', 'INF', 'ARTL', 'FLAK', 'ENG'], mp: 1, q: 0 },
  GOF: { label: 'Motorisierte Division (mit Flak)', units: ['MOT', 'MOT', 'MOT', 'ARTL', 'REC', 'FLAK'], mp: 2, q: 0 },
  GAF: { label: 'Panzer-Division (mit Flak)', units: ['PZL', 'PZM', 'MOT', 'MOT', 'ARTL', 'REC', 'FLAK'], mp: 2, q: 0 },
  ID36: { label: 'Infanterie-Division (in Aufstellung)', units: ['INF:8', 'INF:8', 'INF:6', 'ARTL:7', 'AT:5'], mp: 1, q: 0 },
  GEBB: { label: 'Gebirgs-Brigade', units: ['GEB', 'GEB:6', 'ARTL:6'], mp: 1, q: 1 },
  // Europa 1936: allgemeine Gliederungen der übrigen Staaten
  GI: { label: 'Infanterie-Division', units: ['INF', 'INF', 'INF', 'ARTL', 'AT', 'ENG'], mp: 1, q: 0 },
  GR: { label: 'Reserve-Division', units: ['RES', 'RES', 'RES', 'ARTL:8'], mp: 1, q: -1 },
  GM: { label: 'Gebirgs-Division', units: ['GEB', 'GEB', 'GEB', 'ARTL'], mp: 1, q: 0 },
  GC: { label: 'Kavallerie-Division', units: ['CAV', 'CAV', 'CAV', 'ARTL:6', 'REC'], mp: 2, q: 0 },
  GO: { label: 'Motorisierte Division', units: ['MOT', 'MOT', 'MOT', 'ARTL', 'REC', 'AT'], mp: 2, q: 0 },
  GA: { label: 'Panzer-Division', units: ['PZL', 'PZM', 'MOT', 'MOT', 'ARTL', 'REC', 'AT'], mp: 2, q: 0 },
  GH: { label: 'Schwere Panzer-Brigade', units: ['PZS', 'PZM', 'MOT'], mp: 2, q: 0 },
  GF: { label: 'Festungstruppen', units: ['INF', 'RES', 'ARTH', 'AT'], mp: 0, q: 0 },
  GG: { label: 'Garnison', units: ['RES', 'RES', 'ARTL:5'], mp: 0, q: -1 },
};

// Aufstellung am 1. September 1939 (Heeresgruppe C am Westwall und der polnische
// Grenzschutz KOP an der sowjetischen Grenze sind im MVP weggelassen).
// Format: Seite|Nation|Name|Schablone|Provinz|Armee|Zusatzeinheiten
export const OOB_RAW = `
GER|GER|11. Infanterie-Division|ID1|neidenburg|3. Armee
GER|GER|61. Infanterie-Division|ID2|neidenburg|3. Armee
GER|GER|Panzer-Division Kempf|PZK|neidenburg|3. Armee
GER|GER|1. Infanterie-Division|ID1|ortelsburg|3. Armee
GER|GER|12. Infanterie-Division|ID1|ortelsburg|3. Armee
GER|GER|1. Kavallerie-Brigade|KAVB|ortelsburg|3. Armee
GER|GER|21. Infanterie-Division|ID1|dt_eylau|3. Armee
GER|GER|228. Infanterie-Division|ID3|dt_eylau|3. Armee
GER|GER|217. Infanterie-Division|ID3|allenstein|3. Armee
GER|GER|206. Infanterie-Division|ID3|allenstein|Reserve H.Gr. Nord
GER|GER|Brigade Lötzen|BRIG|johannisburg|3. Armee
GER|GER|Brigade Goldap|BRIG|goldap|3. Armee
GER|DZG|Gruppe Eberhardt|EBER|danzig|3. Armee
GER|GER|207. Infanterie-Division|ID3|lauenburg|4. Armee
GER|GER|3. Panzer-Division|PZD|schlochau|4. Armee
GER|GER|2. Infanterie-Division (mot.)|IDM|schlochau|4. Armee
GER|GER|20. Infanterie-Division (mot.)|IDM|schlochau|4. Armee
GER|GER|3. Infanterie-Division|ID1|schneidemuehl|4. Armee
GER|GER|32. Infanterie-Division|ID1|schneidemuehl|4. Armee
GER|GER|50. Infanterie-Division|ID2|landsberg|4. Armee
GER|GER|Brigade Netze|BRIG|landsberg|4. Armee
GER|GER|23. Infanterie-Division|ID1|neustettin|4. Armee
GER|GER|218. Infanterie-Division|ID3|neustettin|4. Armee
GER|GER|10. Panzer-Division|PZ10|neustettin|Reserve H.Gr. Nord
GER|GER|73. Infanterie-Division|ID2|koeslin|Reserve H.Gr. Nord
GER|GER|208. Infanterie-Division|ID3|koeslin|Reserve H.Gr. Nord
GER|GER|Grenzschutz-Abschnittskommando 12|BRIG|schwiebus|H.Gr. Süd
GER|GER|Grenzschutz-Abschnittskommando 13|BRIG|glogau|H.Gr. Süd
GER|GER|24. Infanterie-Division|ID1|oels|8. Armee
GER|GER|30. Infanterie-Division|ID1|oels|8. Armee
GER|GER|10. Infanterie-Division|ID1|oels|8. Armee
GER|GER|17. Infanterie-Division|ID1|oels|8. Armee
GER|GER|Leibstandarte SS Adolf Hitler|SSR|oels|8. Armee
GER|GER|213. Infanterie-Division|ID3|breslau|Reserve H.Gr. Süd
GER|GER|221. Infanterie-Division|ID3|breslau|Reserve H.Gr. Süd
GER|GER|18. Infanterie-Division|ID1|kreuzburg|10. Armee
GER|GER|19. Infanterie-Division|ID1|kreuzburg|10. Armee
GER|GER|1. Panzer-Division|PZD|kreuzburg|10. Armee
GER|GER|4. Panzer-Division|PZD|kreuzburg|10. Armee
GER|GER|14. Infanterie-Division|ID1|kreuzburg|10. Armee
GER|GER|31. Infanterie-Division|ID1|kreuzburg|10. Armee
GER|GER|4. Infanterie-Division|ID1|strehlitz|10. Armee
GER|GER|46. Infanterie-Division|ID1|strehlitz|10. Armee
GER|GER|2. leichte Division|LEI|strehlitz|10. Armee
GER|GER|3. leichte Division|LEIM|strehlitz|10. Armee
GER|GER|13. Infanterie-Division (mot.)|IDM|strehlitz|10. Armee
GER|GER|29. Infanterie-Division (mot.)|IDM|strehlitz|10. Armee
GER|GER|1. leichte Division|LEIM|oppeln|10. Armee
GER|GER|27. Infanterie-Division|ID1|oppeln|Reserve H.Gr. Süd
GER|GER|68. Infanterie-Division|ID2|oppeln|Reserve H.Gr. Süd
GER|GER|62. Infanterie-Division|ID2|oppeln|Reserve H.Gr. Süd
GER|GER|5. Panzer-Division|PZD|gleiwitz|14. Armee
GER|GER|8. Infanterie-Division|ID1|gleiwitz|14. Armee
GER|GER|28. Infanterie-Division|ID1|gleiwitz|14. Armee
GER|GER|239. Infanterie-Division|ID3|gleiwitz|14. Armee
GER|GER|7. Infanterie-Division|ID1|ostrau|14. Armee
GER|GER|44. Infanterie-Division|ID1|ostrau|14. Armee
GER|GER|45. Infanterie-Division|ID1|ostrau|14. Armee
GER|GER|2. Panzer-Division|PZD|sillein|14. Armee
GER|GER|4. leichte Division|LEI|sillein|14. Armee
GER|GER|3. Gebirgs-Division|GEBD|sillein|14. Armee
GER|GER|1. Gebirgs-Division|GEBD|poprad|14. Armee
GER|GER|2. Gebirgs-Division|GEBD|poprad|14. Armee
GER|SVK|1. Division „Jánošík“|SVKD|poprad|Armee Bernolák
GER|SVK|2. Division „Škultéty“|SVKD|preschau|Armee Bernolák
GER|SVK|3. Division „Rázus“|SVKD|preschau|Armee Bernolák
POL|POL|Lądowa Obrona Wybrzeża|LOW|gdingen|Obrona Wybrzeża
POL|POL|9. Dywizja Piechoty|DP|konitz|Armia Pomorze
POL|POL|Pomorska Brygada Kawalerii|BK|konitz|Armia Pomorze
POL|POL|27. Dywizja Piechoty|DP|stargard_p|Armia Pomorze
POL|POL|15. Dywizja Piechoty|DP|bromberg|Armia Pomorze
POL|POL|16. Dywizja Piechoty|DP|graudenz|Armia Pomorze
POL|POL|4. Dywizja Piechoty|DP|strasburg|Armia Pomorze
POL|POL|20. Dywizja Piechoty|DP|mlawa|Armia Modlin
POL|POL|Nowogródzka Brygada Kawalerii|BK|mlawa|Armia Modlin
POL|POL|8. Dywizja Piechoty|DP|ciechanow|Armia Modlin
POL|POL|Mazowiecka Brygada Kawalerii|BK|przasnysz|Armia Modlin
POL|POL|Twierdza Modlin|GAR|modlin|Armia Modlin
POL|POL|18. Dywizja Piechoty|DP|lomscha|SGO Narew
POL|POL|Podlaska Brygada Kawalerii|BK|lomscha|SGO Narew
POL|POL|33. Dywizja Piechoty (rez.)|DPR|ostrolenka|SGO Narew
POL|POL|Suwalska Brygada Kawalerii|BK|suwalki|SGO Narew
POL|POL|1. Dywizja Piechoty Legionów|DP|pultusk|GO Wyszków
POL|POL|41. Dywizja Piechoty (rez.)|DPR|ostrow_m|GO Wyszków
POL|POL|35. Dywizja Piechoty (rez.)|DPR|wilna|GO Wyszków
POL|POL|14. Dywizja Piechoty|DP|posen|Armia Poznań
POL|POL|17. Dywizja Piechoty|DP|gnesen|Armia Poznań
POL|POL|25. Dywizja Piechoty|DP|kalisch|Armia Poznań
POL|POL|26. Dywizja Piechoty|DP|kolmar|Armia Poznań
POL|POL|Wielkopolska Brygada Kawalerii|BK|lissa|Armia Poznań
POL|POL|Podolska Brygada Kawalerii|BK|neutomischel|Armia Poznań
POL|POL|10. Dywizja Piechoty|DP|sieradz|Armia Łódź
POL|POL|Kresowa Brygada Kawalerii|BK|sieradz|Armia Łódź
POL|POL|28. Dywizja Piechoty|DP|wielun|Armia Łódź
POL|POL|30. Dywizja Piechoty|DP|wielun|Armia Łódź
POL|POL|2. Dywizja Piechoty Legionów|DP|lodz|Armia Łódź
POL|POL|Wołyńska Brygada Kawalerii|BK|tschenstochau|Armia Łódź
POL|POL|7. Dywizja Piechoty|DP|tschenstochau|Armia Kraków
POL|POL|Krakowska Brygada Kawalerii|BK|tschenstochau|Armia Kraków
POL|POL|23. Dywizja Piechoty|DP|kattowitz|Armia Kraków
POL|POL|55. Dywizja Piechoty (rez.)|DPR|kattowitz|Armia Kraków
POL|POL|21. Dywizja Piechoty Górskiej|DPG|bielitz|Armia Kraków
POL|POL|6. Dywizja Piechoty|DP|bielitz|Armia Kraków
POL|POL|1. Brygada Górska|BGOR|neumarkt|Armia Kraków
POL|POL|10. Brygada Kawalerii (zmot.)|BMOT|krakau|Armia Kraków
POL|POL|45. Dywizja Piechoty (rez.)|DPR|krakau|Armia Kraków
POL|POL|22. Dywizja Piechoty Górskiej|DPG|krakau|Armia Prusy
POL|POL|2. Brygada Górska|BGOR|neusandez|Armia Karpaty
POL|POL|3. Brygada Górska|BGOR|krosno|Armia Karpaty
POL|POL|24. Dywizja Piechoty|DP|przemysl|Armia Karpaty
POL|POL|11. Karpacka Dywizja Piechoty|DP|stanislau|Armia Karpaty
POL|POL|38. Dywizja Piechoty (rez.)|DPR|lemberg|Armia Karpaty
POL|POL|Obrona Lwowa|GAR|lemberg|Armia Karpaty
POL|POL|19. Dywizja Piechoty|DP|petrikau|Armia Prusy|TP7
POL|POL|Wileńska Brygada Kawalerii|BK|petrikau|Armia Prusy
POL|POL|13. Dywizja Piechoty|DP|tomaschow|Armia Prusy|TP7
POL|POL|29. Dywizja Piechoty|DP|tomaschow|Armia Prusy
POL|POL|36. Dywizja Piechoty (rez.)|DPR|konskie|Armia Prusy
POL|POL|12. Dywizja Piechoty|DP|kielce|Armia Prusy
POL|POL|3. Dywizja Piechoty Legionów|DP|radom|Armia Prusy
POL|POL|39. Dywizja Piechoty (rez.)|DPR|lublin|Armia Prusy
POL|POL|44. Dywizja Piechoty (rez.)|DPR|lowitsch|Armia Prusy
POL|POL|Warszawska Brygada Pancerno-Motorowa|BPM|deblin|Odwód Naczelnego Wodza
POL|POL|5. Dywizja Piechoty|DP|kutno|Odwód Naczelnego Wodza
POL|POL|Obrona Warszawy|GARW|warschau|Dowództwo Obrony Warszawy
POL|POL|Zgrupowanie Brześć|GAR|brest|Odwód Naczelnego Wodza
POL|POL|Garnizon Grodno|GAR|grodno|Odwód Naczelnego Wodza
`;
