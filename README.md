# Iron Front

Rundenbasierte Strategie im Browser: Divisionen auf einer Provinzkarte, Regimenter und
Abteilungen auf einer Hex-Schlachtkarte. Drei Szenarien:

- **Welt 1936** – wie Europa 1936, aber auf der ganzen Welt (1180 Provinzen): Japan, China, die USA,
  das britische Empire. Japans Krieg in China und die Eroberungen 1941/42 laufen als Ereignisse nach
  historischem Fahrplan, danach kämpft die KI. Spielbar ist weiterhin nur das Deutsche Reich.
- **Europa 1936** – das Deutsche Reich ab dem 1. Januar 1936 auf einer Karte von Europa,
  Nordafrika und Vorderasien, mit Wirtschaft, Fertigung, Forschung, Nachschub und den
  historischen Ereignissen. Siehe unten.
- **Polenfeldzug 1939** – der Angriff auf Polen vom 1. September bis 6. Oktober 1939 mit
  historischer Aufstellung, ohne Wirtschaft. Die „Regeln in Kürze“ beschreiben dieses Szenario;
  Schlachten, Luftwaffe und Nebel des Krieges gelten in beiden.

## Starten

    npm install
    npm run dev      # Entwicklungsserver
    npm run build    # statischer Build nach dist/
    npm run sim      # Polen 1939, KI gegen KI im Terminal
    npm run sim:eu   # Europa 1936, KI führt auch das Reich: npm run sim:eu [seed] [bis Jahr]
    npm run sim:welt # dasselbe auf der Weltkarte
    npm run map:eu   # Europakarte neu erzeugen (braucht die Natural-Earth-Dateien unter tools/ne/)
    npm run map:welt # Weltkarte neu erzeugen (übernimmt die Provinzen der Europakarte)
    npm run map      # Karte neu erzeugen (braucht Natural-Earth-GeoJSON unter tools/ne/)

## Regeln in Kürze

- Eine Runde entspricht drei Tagen, der Feldzug dauert 12 Runden. Erst zieht Deutschland, dann Polen.
- Fußtruppen ziehen eine Provinz, schnelle Verbände zwei. Züge in feindfreie Provinzen
  geschehen sofort, Angriffe werden vorgemerkt und am Ende der Phase ausgefochten.
- Je Schlacht kämpfen höchstens drei Divisionen pro Seite, weitere rücken bei Erfolg nach.
- Jede Schlacht lässt sich von Hand führen oder per Auto-Resolve entscheiden. Auto-Resolve
  spielt dieselbe Hex-Schlacht mit der KI auf beiden Seiten, es gibt kein zweites Rechenmodell.
- Eine Schlacht dauert bis zu 12 Züge von je rund sechs Stunden. Der Angreifer gewinnt, wenn er
  alle Ziele nimmt, den Hauptort am Ende hält oder die Verteidiger unter 35 % Stärke drückt.
- Luftwaffe: Jagd- und Bomberstaffeln werden Sektoren zugeteilt (Provinz samt Nachbarn). Wer in einer
  Schlacht mehr Jäger hat, besitzt die Luftüberlegenheit: doppelte Sichtweite, und gegnerische
  Bomber gehen bei ihren Einsätzen teils verloren. Jede Bomberstaffel fliegt einen Einsatz pro Tag.
- Nebel des Krieges: Auf der Schlachtkarte sieht man Gegner nur in Sichtweite (2 Felder, Aufklärer 4),
  auf der Strategiekarte nur an der Front und unter eigenen Luftsektoren, Stärken nur geschätzt.
- Artillerie rückt entweder ein Feld nach und feuert im selben Zug noch, oder sie verlegt
  aufgeprotzt weiter und feuert erst im nächsten Zug wieder.
- Auf der Schlachtkarte eingeschlossene Einheiten kämpfen schlechter und verlieren Stärke.
- Tasten: Tab nächster freier Verband, Leertaste aussetzen, Enter Runde bzw. Zug beenden.
- Abgeschnittene Verbände (kein Landweg über eigenes Gebiet zu einer Versorgungsquelle)
  kämpfen schlechter und verlieren jede Runde Stärke.
- Deutschland gewinnt mit Warschau und 14 von 20 Siegpunkten, Polen, wenn Warschau am Ende hält.

## Europa 1936

Gespielt wird nur das Deutsche Reich; Verbündete und Gegner führt die KI.

- **Zeit:** im Frieden ein Monat je Runde, im Krieg eine Woche. Ende am 1. Januar 1946 oder mit dem Fall Berlins.
- **Karte:** 558 Provinzen, als Voronoi-Zellen um Orte aus Natural Earth; Staatsgrenzen von 1936 angenähert.
  Neutrale Staaten sind nicht betretbar und stellen ihr Heer erst beim Kriegseintritt auf.
- **Ereignisse:** Rheinland, Spanischer Bürgerkrieg (Entscheidung: Legion Condor), Anschluss Österreichs,
  Münchner Abkommen, Zerschlagung der Tschechoslowakei, Memel, Nichtangriffspakt, sowjetischer Einmarsch
  in Ostpolen, Winterkrieg, Baltikum, Kriegseintritt Italiens, Vichy, Beitritte zum Dreimächtepakt,
  Kriegseintritt der USA, Landung in Nordafrika. Kriegserklärungen sind Sache des Spielers; zu den
  historischen Stichtagen (Fall Weiß, Weserübung, Fall Gelb, Balkan, Barbarossa) fragt das Spiel nach.
- **Wirtschaft:** Die Industrie (IK) wird per Regler auf Forschung, Nachschubgüter und neun Fertigungslinien
  verteilt. Stahl begrenzt die Fertigung, Öl die schnellen Verbände und die Luftwaffe, Mannschaften den Ersatz.
- **Ausbau und Öl:** Industrieausbau bringt dauerhaft zusätzliche IK. Hydrierwerke (nach Erforschung der
  Kohlehydrierung) machen aus der Kohle der eigenen Reviere Öl. Öl liegt in Tanklagern, die ausgebaut werden
  müssen; was sie nicht fassen, geht verloren. Im Reiter „Handel“ wird Öl gegen Ausfuhrgüter (IK) eingekauft
  oder gegen Stahl und Güter verkauft – der Seeweg schließt sich im Krieg mit Großbritannien.
- **Marine:** Schiffe stehen nicht auf der Karte, sondern werden Seegebieten zugeteilt (Reich verwalten → Marine).
  Transportflotten tragen Verbände und Nachschub über See, U-Boote führen den Handelskrieg, Zerstörer, Schlachtschiffe
  und Flugzeugträger ringen um die Seeherrschaft, die die Verluste bei Überfahrten bestimmt. Träger brauchen drei
  Stufen Grundlagenforschung und eine eigene Fertigung für Trägerflugzeuge.
- **Waffen:** Jede Linie fertigt ein Muster (z. B. Panzer II). Ist ein neues Muster erforscht, muss die Linie
  umgestellt werden und läuft dann erst wieder an. Je Linie legt ein zweiter Regler fest, welcher Anteil
  in die Umrüstung (und den Ersatz) bestehender Einheiten geht und welcher in Neuaufstellungen.
- **Aufstellung:** Neue Verbände werden Bataillon für Bataillon aus dem Neulager ausgestattet, von Hand
  oder selbsttätig.
- **Nachschub:** Wege über eigenes Gebiet und zwischen eigenen Häfen; jenseits der Reichweite gibt es
  keinen Ersatz und weniger Kampfkraft, ohne Verbindung Verluste.
- **Verlegung:** Bahn (weit durch eigenes Gebiet, kostet die Runde), Seetransport zwischen Häfen und
  Landungen an feindlicher Küste, mit Verlusten bei feindlicher Seeherrschaft.

Noch nicht enthalten: Flotten, Handel und Diplomatie über Kriegserklärungen hinaus, Partisanen, Wetter,
Japan und der Pazifik. Heeresstärken der KI-Staaten sind Näherungen und werden nach Regeln verteilt,
nicht nach historischen Standorten; die deutsche KI im Probelauf ist schwach, die Balance ungetestet.

## Aufbau

- `src/core` – Spiellogik ohne DOM (Strategie, Schlacht, KI). Läuft auch headless.
- `src/data` – Provinzen, Einheitentypen, Divisionsschablonen, Aufstellung vom 1.9.1939.
- `src/ui` – Canvas-Darstellung und Bedienung.
- `tools` – Kartenerzeugung und Simulationslauf.

Die Trennung von Logik und Oberfläche und die relativen Pfade im Build sind so gewählt,
dass sich das Spiel später in eine Desktop-Hülle (Tauri oder Electron) packen lässt.

## Daten und Vereinfachungen

- Küsten, Seen und Flüsse stammen aus Natural Earth (gemeinfrei).
- Provinzen sind Voronoi-Zellen um historische Orte; die Grenzen von 1939 sind dadurch nur angenähert.
- Die Aufstellung folgt den historischen Armeen und Divisionen, die Zuordnung zu Provinzen ist
  vereinfacht. Heeresgruppe C, der polnische Grenzschutz KOP, Marine und der sowjetische
  Einmarsch vom 17. September fehlen.
- Kampfwerte, Schlachtkarten (aus dem Geländetyp der Provinz erzeugt) und Grafik sind Platzhalter.
