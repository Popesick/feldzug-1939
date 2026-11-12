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

/** Ränge vom Generalmajor (1) bis zum Generalfeldmarschall (5). Rang 3 trägt die Waffengattung im Titel. */
export const RANKS = ['', 'Generalmajor', 'Generalleutnant', 'General', 'Generaloberst', 'Generalfeldmarschall'];
export const RANK_MAX = 5;
/** Gewonnene Gefechte bis zur nächsten Beförderung, je nach jetzigem Rang. */
export const WINS_NEEDED = [0, 3, 5, 8, 12];

export interface General {
  id: string;
  name: string;
  arm: string; // Waffengattung für den Titel „General der …“
  rank: number; // Rang bei Spielbeginn bzw. beim ersten Auftreten
  from: number; // verfügbar ab (Jahr mit Bruchteil)
  path: Trait[]; // welcher Vorteil mit welchem Rang hinzukommt
}

const G = (name: string, arm: string, rank: number, from: number, ...path: Trait[]): General =>
  ({ id: name.toLowerCase().replace(/[^a-zäöüß]+/g, '_'), name, arm, rank, from, path });

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
];
export const GENERAL: Record<string, General> = Object.fromEntries(GENERALS.map(x => [x.id, x]));
