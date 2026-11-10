# Feldzug 1939 (Arbeitstitel)

Rundenbasierte Strategie im Browser: Divisionen auf einer Provinzkarte, Regimenter und
Abteilungen auf einer Hex-Schlachtkarte. Der MVP deckt den deutschen Angriff auf Polen
vom 1. September bis 6. Oktober 1939 ab – ohne Wirtschaft, Forschung und Diplomatie.

## Starten

    npm install
    npm run dev      # Entwicklungsserver
    npm run build    # statischer Build nach dist/
    npm run sim      # KI gegen KI, ganzer Feldzug im Terminal
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
- Abgeschnittene Verbände (kein Landweg über eigenes Gebiet zu einer Versorgungsquelle)
  kämpfen schlechter und verlieren jede Runde Stärke.
- Deutschland gewinnt mit Warschau und 14 von 20 Siegpunkten, Polen, wenn Warschau am Ende hält.

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
