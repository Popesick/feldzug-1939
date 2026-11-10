import type { UnitType, UnitTypeId } from '../core/types';

// Platzhalterwerte. Später sollen sie per Formel aus realen technischen Daten
// (Kaliber, Panzerung, Motorleistung, Sollstärke) abgeleitet werden.
const T = (
  id: UnitTypeId, ger: string, pol: string, sym: UnitType['sym'],
  sa: number, ha: number, def: number, mp: number, move: UnitType['move'], rng: number, ini: number, hard = false,
): UnitType => ({ id, name: { GER: ger, POL: pol }, sym, sa, ha, def, mp, move, rng, ini, hard });

export const TYPES: Record<UnitTypeId, UnitType> = {
  INF: T('INF', 'Infanterie-Regiment', 'Pułk Piechoty', 'inf', 6, 2, 6, 3, 'foot', 1, 2),
  RES: T('RES', 'Landwehr-Regiment', 'Pułk Piechoty (rez.)', 'inf', 5, 1, 5, 3, 'foot', 1, 1),
  GEB: T('GEB', 'Gebirgsjäger-Regiment', 'Pułk Strzelców Podhalańskich', 'mtn', 7, 2, 7, 3, 'foot', 1, 3),
  MOT: T('MOT', 'Schützen-Regiment (mot.)', 'Pułk Strzelców (zmot.)', 'mot', 7, 3, 6, 6, 'wheel', 1, 3),
  CAV: T('CAV', 'Reiter-Regiment', 'Pułk Ułanów', 'cav', 5, 2, 4, 5, 'horse', 1, 3),
  ENG: T('ENG', 'Pionier-Bataillon', 'Batalion Saperów', 'eng', 6, 3, 6, 3, 'foot', 1, 2),
  AT: T('AT', 'Panzerabwehr-Abteilung (3,7 cm)', 'Kompanie ppanc. (37 mm Bofors)', 'at', 2, 7, 4, 3, 'foot', 1, 4),
  REC: T('REC', 'Aufklärungs-Abteilung', 'Dywizjon Rozpoznawczy', 'rec', 4, 3, 3, 7, 'wheel', 1, 4),
  ARTL: T('ARTL', 'Artillerie-Abt. (10,5 cm leFH 18)', 'Pułk Artylerii Lekkiej (75 mm)', 'art', 7, 2, 2, 3, 'foot', 3, 1),
  ARTH: T('ARTH', 'Schwere Art.-Abt. (15 cm sFH 18)', 'Dywizjon Art. Ciężkiej (155 mm)', 'art', 9, 3, 2, 2, 'foot', 4, 1),
  PZL: T('PZL', 'Panzer-Regiment (Pz I/II)', 'Batalion Czołgów Lekkich', 'arm', 8, 5, 7, 5, 'track', 1, 5, true),
  PZM: T('PZM', 'Panzer-Abteilung (Pz III/IV)', 'Batalion Czołgów', 'arm', 9, 9, 9, 5, 'track', 1, 6, true),
  TKS: T('TKS', 'Panzerspäh-Abteilung', 'Dywizjon Pancerny (TKS, wz. 34)', 'arm', 5, 3, 4, 5, 'track', 1, 3, true),
  TP7: T('TP7', 'Panzer-Abteilung', 'Batalion Czołgów Lekkich (7TP)', 'arm', 7, 8, 7, 5, 'track', 1, 5, true),
};

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
