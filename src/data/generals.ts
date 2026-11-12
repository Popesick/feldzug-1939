// Generäle des Heeres. Namen, Waffengattung und ungefähre Beförderungsdaten sind historisch;
// die Stärken sind eine eigene, grobe Einschätzung nach dem bekannten Werdegang.

export type Trait = 'def' | 'att' | 'sup' | 'pz' | 'inf' | 'kav' | 'mar';
export const TRAITS: Record<Trait, { name: string; text: string }> = {
  def: { name: 'Verteidiger', text: 'Abwehr aller Bataillone' },
  att: { name: 'Angreifer', text: 'Angriff aller Bataillone' },
  sup: { name: 'Versorger', text: 'Reichweite des Nachschubs' },
  pz: { name: 'Panzergeneral', text: 'Angriff und Abwehr der Panzer' },
  inf: { name: 'Infanteriegeneral', text: 'Angriff und Abwehr der Infanterie' },
  kav: { name: 'Kavalleriegeneral', text: 'Angriff und Abwehr der Kavallerie und der schnellen Truppen (mot. Infanterie, Aufklärung)' },
  mar: { name: 'Eilmarsch', text: 'Bewegung auf der Strategiekarte' },
};

/** Ränge je Staat, vom untersten Generalsrang (1) aufwärts. Beim Reich trägt Rang 3 die Waffengattung im Titel. */
export const RANKS_OF: Record<string, string[]> = {
  GER: ['', 'Generalmajor', 'Generalleutnant', 'General', 'Generaloberst', 'Generalfeldmarschall'],
  SOV: ['', 'Generalmajor', 'Generalleutnant', 'Generaloberst', 'Armeegeneral', 'Marschall der Sowjetunion'],
  ENG: ['', 'Major-General', 'Lieutenant-General', 'General', 'Field Marshal'],
  FRA: ['', 'Général de brigade', 'Général de division', 'Général de corps d’armée', 'Général d’armée', 'Maréchal de France'],
  USA: ['', 'Brigadier General', 'Major General', 'Lieutenant General', 'General', 'General of the Army'],
  JAP: ['', 'Shōshō (Generalmajor)', 'Chūjō (Generalleutnant)', 'Taishō (General)', 'Gensui (Marschall)'],
  CHI: ['', 'Generalmajor', 'Generalleutnant', 'General 2. Klasse', 'General 1. Klasse'],
};
/** Großmächte, deren Armeen die KI unter Generäle stellt. */
export const GENERAL_NATIONS = ['SOV', 'ENG', 'FRA', 'JAP', 'USA', 'CHI'];
/** Gewonnene Gefechte bis zur nächsten Beförderung, je nach jetzigem Rang. */
export const WINS_NEEDED = [0, 3, 5, 8, 12];

export interface General {
  id: string;
  nat: string; // Staat
  name: string;
  arm: string; // Waffengattung für den Titel „General der …“
  rank: number; // Rang bei Spielbeginn bzw. beim ersten Auftreten
  from: number; // verfügbar ab (Jahr mit Bruchteil)
  path: Trait[]; // welcher Vorteil mit welchem Rang hinzukommt
}

const G = (name: string, arm: string, rank: number, from: number, ...path: Trait[]): General =>
  ({ id: name.toLowerCase().replace(/[^a-zäöüß]+/g, '_'), nat: 'GER', name, arm, rank, from, path });
/** Generäle der übrigen Mächte: [Name, Rang zu Beginn, verfügbar ab, Werdegang]. */
const N = (nat: string, list: [string, number, number, Trait[]][]): General[] =>
  list.map(([name, rank, from, path]) => ({ id: `${nat.toLowerCase()}_${name.toLowerCase().replace(/[^a-z]+/g, '_')}`, nat, name, arm: '', rank, from, path }));

export const GENERALS: General[] = [
  G('Gerd von Rundstedt', 'Infanterie', 3, 1936, 'att', 'def', 'sup', 'def', 'att'),
  G('Fedor von Bock', 'Infanterie', 3, 1936, 'att', 'inf', 'att', 'inf', 'att'),
  G('Wilhelm Ritter von Leeb', 'Artillerie', 3, 1936, 'def', 'inf', 'def', 'sup', 'def'),
  G('Wilhelm List', 'Infanterie', 3, 1936, 'inf', 'mar', 'att', 'sup', 'inf'),
  G('Wilhelm Adam', 'Infanterie', 3, 1936, 'def', 'sup', 'def', 'inf', 'def'),
  G('Walther von Brauchitsch', 'Artillerie', 2, 1936, 'sup', 'inf', 'def', 'sup', 'inf'),
  G('Walther von Reichenau', 'Artillerie', 2, 1936, 'att', 'mar', 'att', 'inf', 'att'),
  G('Günther von Kluge', 'Artillerie', 2, 1936, 'inf', 'def', 'inf', 'att', 'def'),
  G('Erwin von Witzleben', 'Infanterie', 2, 1936, 'def', 'inf', 'def', 'inf', 'sup'),
  G('Johannes Blaskowitz', 'Infanterie', 2, 1936, 'inf', 'sup', 'def', 'inf', 'sup'),
  G('Georg von Küchler', 'Artillerie', 2, 1936, 'inf', 'att', 'def', 'inf', 'def'),
  G('Ewald von Kleist', 'Kavallerie', 2, 1936, 'kav', 'pz', 'kav', 'pz', 'att'),
  G('Maximilian von Weichs', 'Kavallerie', 2, 1936, 'kav', 'pz', 'def', 'kav', 'sup'),
  G('Hermann Hoth', 'Infanterie', 1, 1936, 'pz', 'inf', 'pz', 'att', 'pz'),
  G('Erich Hoepner', 'Kavallerie', 1, 1936, 'pz', 'kav', 'pz', 'att', 'mar'),
  G('Gotthard Heinrici', 'Infanterie', 1, 1936, 'def', 'inf', 'def', 'sup', 'def'),
  G('Ernst Busch', 'Infanterie', 1, 1936, 'inf', 'att', 'inf', 'def', 'inf'),
  G('Heinrich von Vietinghoff', 'Panzertruppe', 1, 1936.3, 'def', 'pz', 'def', 'inf', 'sup'),
  G('Heinz Guderian', 'Panzertruppe', 1, 1936.6, 'pz', 'mar', 'pz', 'att', 'pz'),
  G('Georg Stumme', 'Kavallerie', 1, 1936.6, 'kav', 'pz', 'mar', 'kav', 'att'),
  G('Erich von Manstein', 'Infanterie', 1, 1936.75, 'att', 'def', 'pz', 'att', 'def'),
  G('Georg-Hans Reinhardt', 'Panzertruppe', 1, 1937.3, 'pz', 'inf', 'pz', 'def', 'att'),
  G('Eberhard von Mackensen', 'Kavallerie', 1, 1938, 'kav', 'pz', 'att', 'kav', 'def'),
  G('Walter Model', 'Infanterie', 1, 1938.2, 'def', 'inf', 'def', 'pz', 'def'),
  G('Eduard Dietl', 'Gebirgstruppe', 1, 1938.3, 'inf', 'def', 'inf', 'sup', 'inf'),
  G('Friedrich Paulus', 'Panzertruppe', 1, 1939, 'sup', 'pz', 'sup', 'inf', 'def'),
  G('Erwin Rommel', 'Panzertruppe', 1, 1939.6, 'pz', 'att', 'pz', 'att', 'pz'),
  G('Hans-Valentin Hube', 'Panzertruppe', 1, 1940.5, 'pz', 'def', 'pz', 'inf', 'att'),
  G('Walther Nehring', 'Panzertruppe', 1, 1940.6, 'pz', 'mar', 'pz', 'sup', 'att'),
  G('Ferdinand Schörner', 'Gebirgstruppe', 1, 1940.6, 'def', 'inf', 'def', 'inf', 'def'),
  G('Erhard Raus', 'Panzertruppe', 1, 1941.7, 'def', 'pz', 'def', 'att', 'pz'),
  G('Hermann Balck', 'Panzertruppe', 1, 1942.6, 'pz', 'att', 'pz', 'mar', 'att'),
  G('Hasso von Manteuffel', 'Panzertruppe', 1, 1943.4, 'pz', 'att', 'pz', 'mar', 'pz'),
  ...N('SOV', [
    ['Kliment Woroschilow', 5, 1936, ['sup', 'def', 'inf', 'sup', 'def']],
    ['Semjon Budjonny', 5, 1936, ['kav', 'kav', 'mar', 'kav', 'sup']],
    ['Boris Schaposchnikow', 4, 1936, ['def', 'sup', 'def', 'sup', 'inf']],
    ['Semjon Timoschenko', 2, 1936, ['inf', 'att', 'def', 'inf', 'sup']],
    ['Georgi Schukow', 1, 1936, ['att', 'pz', 'att', 'def', 'att']],
    ['Iwan Konew', 1, 1936, ['att', 'inf', 'pz', 'att', 'att']],
    ['Kirill Merezkow', 1, 1936, ['inf', 'def', 'att', 'inf', 'sup']],
    ['Andrei Jerjomenko', 1, 1938, ['def', 'kav', 'def', 'inf', 'att']],
    ['Wassili Tschuikow', 1, 1938.5, ['def', 'inf', 'def', 'def', 'att']],
    ['Konstantin Rokossowski', 1, 1940.3, ['pz', 'att', 'def', 'pz', 'att']],
    ['Alexander Wassilewski', 1, 1940.5, ['sup', 'att', 'def', 'att', 'sup']],
    ['Rodion Malinowski', 1, 1940.5, ['inf', 'def', 'att', 'inf', 'att']],
    ['Fjodor Tolbuchin', 1, 1940.5, ['inf', 'sup', 'att', 'inf', 'def']],
    ['Nikolai Watutin', 2, 1940.5, ['att', 'pz', 'att', 'mar', 'att']],
    ['Pawel Rotmistrow', 1, 1941.5, ['pz', 'pz', 'att', 'pz', 'mar']],
    ['Iwan Bagramjan', 1, 1941.6, ['att', 'sup', 'inf', 'att', 'pz']],
  ]),
  ...N('ENG', [
    ['Edmund Ironside', 3, 1936, ['def', 'inf', 'sup', 'def', 'inf']],
    ['Lord Gort', 1, 1936, ['inf', 'def', 'inf', 'def', 'sup']],
    ['Archibald Wavell', 1, 1936, ['sup', 'def', 'att', 'sup', 'inf']],
    ['Alan Brooke', 1, 1936, ['def', 'sup', 'def', 'att', 'inf']],
    ['Henry Maitland Wilson', 1, 1936, ['sup', 'def', 'inf', 'sup', 'def']],
    ['Claude Auchinleck', 1, 1936, ['def', 'inf', 'sup', 'def', 'att']],
    ['Harold Alexander', 1, 1937.8, ['def', 'inf', 'att', 'sup', 'def']],
    ['Richard O’Connor', 1, 1938.7, ['att', 'pz', 'mar', 'att', 'pz']],
    ['Bernard Montgomery', 1, 1938.8, ['att', 'sup', 'def', 'inf', 'att']],
    ['William Slim', 1, 1941.4, ['inf', 'sup', 'def', 'att', 'mar']],
    ['Miles Dempsey', 1, 1941.5, ['inf', 'att', 'pz', 'sup', 'att']],
    ['Brian Horrocks', 1, 1941.5, ['pz', 'att', 'mar', 'pz', 'att']],
  ]),
  ...N('FRA', [
    ['Maurice Gamelin', 4, 1936, ['def', 'sup', 'def', 'inf', 'def']],
    ['Maxime Weygand', 4, 1936, ['def', 'inf', 'def', 'sup', 'att']],
    ['Alphonse Georges', 4, 1936, ['def', 'inf', 'sup', 'def', 'inf']],
    ['Gaston Billotte', 3, 1936, ['inf', 'pz', 'def', 'att', 'inf']],
    ['André-Gaston Prételat', 3, 1936, ['def', 'def', 'inf', 'sup', 'def']],
    ['Charles Huntziger', 2, 1936, ['inf', 'def', 'sup', 'inf', 'def']],
    ['Henri Giraud', 2, 1936, ['att', 'inf', 'mar', 'att', 'def']],
    ['René Prioux', 2, 1936, ['kav', 'pz', 'kav', 'def', 'att']],
    ['Alphonse Juin', 1, 1939, ['inf', 'att', 'inf', 'mar', 'att']],
    ['Jean de Lattre de Tassigny', 1, 1939.2, ['att', 'inf', 'mar', 'att', 'pz']],
    ['Charles de Gaulle', 1, 1940.4, ['pz', 'att', 'pz', 'mar', 'att']],
    ['Philippe Leclerc', 1, 1941.6, ['pz', 'mar', 'att', 'pz', 'mar']],
  ]),
  ...N('USA', [
    ['Douglas MacArthur', 4, 1936, ['def', 'att', 'sup', 'mar', 'att']],
    ['Walter Krueger', 1, 1936, ['inf', 'sup', 'att', 'def', 'inf']],
    ['George C. Marshall', 1, 1936.8, ['sup', 'sup', 'inf', 'sup', 'def']],
    ['Joseph Stilwell', 1, 1939.5, ['inf', 'def', 'mar', 'att', 'sup']],
    ['Courtney Hodges', 1, 1940.4, ['inf', 'def', 'att', 'inf', 'sup']],
    ['Jacob Devers', 1, 1940.4, ['pz', 'sup', 'att', 'inf', 'pz']],
    ['George S. Patton', 1, 1940.8, ['pz', 'att', 'mar', 'pz', 'att']],
    ['Omar Bradley', 1, 1941.1, ['inf', 'att', 'inf', 'sup', 'def']],
    ['Mark W. Clark', 1, 1941.6, ['inf', 'att', 'def', 'inf', 'sup']],
    ['Alexander Patch', 1, 1941.6, ['inf', 'att', 'sup', 'def', 'inf']],
    ['Dwight D. Eisenhower', 1, 1941.7, ['sup', 'att', 'sup', 'inf', 'att']],
    ['Lucian Truscott', 1, 1942.4, ['att', 'kav', 'mar', 'inf', 'att']],
  ]),
  ...N('JAP', [
    ['Hisaichi Terauchi', 3, 1936, ['sup', 'att', 'inf', 'sup', 'att']],
    ['Iwane Matsui', 3, 1936, ['inf', 'att', 'inf', 'att', 'sup']],
    ['Shunroku Hata', 2, 1936, ['inf', 'att', 'sup', 'inf', 'def']],
    ['Yasuji Okamura', 2, 1936, ['inf', 'def', 'att', 'inf', 'sup']],
    ['Kenji Doihara', 2, 1936, ['sup', 'inf', 'att', 'sup', 'def']],
    ['Seishirō Itagaki', 2, 1936, ['att', 'inf', 'att', 'pz', 'inf']],
    ['Tomoyuki Yamashita', 1, 1936, ['att', 'mar', 'att', 'inf', 'def']],
    ['Masaharu Homma', 1, 1936, ['inf', 'att', 'sup', 'inf', 'att']],
    ['Hitoshi Imamura', 1, 1936, ['inf', 'sup', 'att', 'def', 'inf']],
    ['Mitsuru Ushijima', 1, 1937.2, ['def', 'inf', 'def', 'inf', 'def']],
    ['Tadamichi Kuribayashi', 1, 1940.2, ['def', 'def', 'inf', 'def', 'def']],
  ]),
  ...N('CHI', [
    ['He Yingqin', 4, 1936, ['sup', 'def', 'inf', 'sup', 'def']],
    ['Li Zongren', 4, 1936, ['def', 'inf', 'att', 'def', 'inf']],
    ['Yan Xishan', 4, 1936, ['def', 'sup', 'def', 'inf', 'sup']],
    ['Bai Chongxi', 3, 1936, ['att', 'mar', 'def', 'att', 'inf']],
    ['Chen Cheng', 2, 1936, ['inf', 'def', 'sup', 'inf', 'att']],
    ['Xue Yue', 2, 1936, ['def', 'att', 'def', 'inf', 'def']],
    ['Wei Lihuang', 2, 1936, ['inf', 'att', 'inf', 'def', 'att']],
    ['Zhang Zizhong', 2, 1936, ['inf', 'def', 'att', 'inf', 'def']],
    ['Fu Zuoyi', 2, 1936, ['def', 'kav', 'def', 'inf', 'sup']],
    ['Hu Zongnan', 2, 1936, ['inf', 'def', 'sup', 'inf', 'def']],
    ['Tang Enbo', 2, 1936, ['inf', 'att', 'def', 'inf', 'att']],
    ['Du Yuming', 1, 1937.5, ['pz', 'att', 'inf', 'pz', 'def']],
    ['Sun Li-jen', 1, 1940, ['att', 'inf', 'mar', 'att', 'inf']],
  ]),
];
export const GENERAL: Record<string, General> = Object.fromEntries(GENERALS.map(x => [x.id, x]));
