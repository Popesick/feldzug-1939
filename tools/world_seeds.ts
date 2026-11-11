// Fest gesetzte Orte der Weltkarte außerhalb des Europa-Ausschnitts.
// Name|Breite|Länge|Staat 1936|Siegpunkte|Kennzeichen
// Kennzeichen: c Hauptstadt, u Stadtgebiet, k Kolonie oder Außenbesitzung, P Hafen,
// L Landverbindung zum nächsten Nachbarort (Insel mit Damm oder Fähre),
// N Atlantik, Z Pazifik, I Indischer Ozean (sonst aus der Lage bestimmt).
export const FORCED_W = `
Washington|38.9|-77.04|USA|3|c
New York|40.71|-74.0|USA|3|uPL
Boston|42.36|-71.06|USA|1|P
Philadelphia|39.95|-75.17|USA|1|P
Pittsburgh|40.44|-80.0|USA|1|
Chicago|41.88|-87.63|USA|2|u
Detroit|42.33|-83.05|USA|2|
Norfolk|36.85|-76.29|USA|1|P
Atlanta|33.75|-84.39|USA|0|
Miami|25.76|-80.19|USA|0|P
New Orleans|29.95|-90.07|USA|1|P
Houston|29.76|-95.37|USA|1|P
Dallas|32.78|-96.8|USA|0|
St. Louis|38.63|-90.2|USA|1|
Denver|39.74|-104.99|USA|0|
Los Angeles|34.05|-118.24|USA|2|P
San Francisco|37.77|-122.42|USA|2|P
Seattle|47.61|-122.33|USA|1|P
Anchorage|61.22|-149.9|USA|0|kP
Honolulu|21.31|-157.86|USA|2|kP
Midway|28.2|-177.37|USA|0|kP
Wake|19.28|166.65|USA|0|kP
Guam|13.47|144.75|USA|0|kP
Manila|14.6|120.98|USA|2|kP
Davao|7.07|125.61|USA|0|kP
San Juan|18.47|-66.1|USA|0|kP
Ottawa|45.42|-75.7|CAN|1|c
Montreal|45.5|-73.57|CAN|2|P
Toronto|43.65|-79.38|CAN|2|
Halifax|44.65|-63.57|CAN|1|P
Winnipeg|49.9|-97.14|CAN|0|
Vancouver|49.28|-123.12|CAN|1|P
St. John’s|47.56|-52.71|ENG|0|kP
Reykjavik|64.15|-21.94|DNK|0|kP
Godthaab|64.18|-51.72|DNK|0|kP
Mexiko-Stadt|19.43|-99.13|MEX|1|c
Veracruz|19.17|-96.13|MEX|0|P
Tampico|22.25|-97.86|MEX|0|P
Havanna|23.13|-82.38|CUB|1|cP
Port-au-Prince|18.54|-72.34|HAI|0|cP
Santo Domingo|18.47|-69.9|DOM|0|cP
Kingston|18.0|-76.8|ENG|0|kP
Guatemala-Stadt|14.63|-90.51|GUA|0|c
Tegucigalpa|14.07|-87.19|HON|0|c
San Salvador|13.69|-89.19|SAL|0|c
Managua|12.13|-86.25|NIC|0|c
San José|9.93|-84.08|COS|0|c
Panama|8.98|-79.52|PAN|1|cPNZ
Bogotá|4.71|-74.07|COL|1|c
Caracas|10.48|-66.9|VEN|1|cP
Maracaibo|10.65|-71.64|VEN|0|P
Port of Spain|10.65|-61.5|ENG|0|kP
Georgetown|6.8|-58.16|ENG|0|kP
Paramaribo|5.85|-55.2|NLD|0|kP
Cayenne|4.93|-52.33|FRA|0|kP
Quito|-0.18|-78.47|ECU|0|c
Lima|-12.05|-77.04|PRU|1|cP
La Paz|-16.5|-68.15|BOL|0|c
Rio de Janeiro|-22.91|-43.17|BRA|2|cP
São Paulo|-23.55|-46.63|BRA|1|
Recife|-8.05|-34.9|BRA|0|P
Belém|-1.46|-48.5|BRA|0|P
Manaus|-3.12|-60.02|BRA|0|
Asunción|-25.26|-57.58|PAR|0|c
Montevideo|-34.9|-56.16|URU|0|cP
Buenos Aires|-34.6|-58.38|ARG|2|cP
Santiago|-33.45|-70.67|CHL|1|cP
Dakar|14.69|-17.45|FRA|1|kP
Freetown|8.48|-13.23|ENG|0|kP
Monrovia|6.3|-10.8|LIB|0|cP
Accra|5.56|-0.2|ENG|0|kP
Lagos|6.45|3.39|ENG|1|kP
Kano|12.0|8.52|ENG|0|k
Douala|4.05|9.7|FRA|0|kP
Fort-Lamy|12.11|15.04|FRA|0|k
Pointe-Noire|-4.78|11.86|FRA|0|kP
Léopoldville|-4.32|15.31|BEL|1|k
Elisabethville|-11.66|27.48|BEL|0|k
Luanda|-8.84|13.23|POR|0|kP
Lourenço Marques|-25.97|32.57|POR|0|kP
Windhuk|-22.56|17.08|SAF|0|
Kapstadt|-33.92|18.42|SAF|1|PNI
Pretoria|-25.75|28.19|SAF|1|c
Durban|-29.86|31.02|SAF|0|P
Salisbury|-17.83|31.05|ENG|0|k
Nairobi|-1.29|36.82|ENG|1|k
Mombasa|-4.04|39.67|ENG|0|kP
Daressalam|-6.8|39.28|ENG|0|kP
Khartum|15.5|32.56|ENG|1|k
Port Sudan|19.62|37.22|ENG|0|kP
Addis Abeba|9.03|38.74|ETH|1|c
Massaua|15.61|39.45|ITA|0|kP
Mogadischu|2.05|45.32|ITA|0|kP
Dschibuti|11.59|43.15|FRA|0|kP
Berbera|10.44|45.01|ENG|0|kP
Tananarive|-18.88|47.51|FRA|0|k
Diego Suarez|-12.28|49.29|FRA|0|kP
Aden|12.79|45.03|ENG|1|kP
Sanaa|15.35|44.21|YEM|0|c
Maskat|23.59|58.38|ENG|0|kP
Riad|24.71|46.68|SAU|0|c
Teheran|35.69|51.39|PER|1|c
Kabul|34.53|69.17|AFG|0|c
Omsk|54.99|73.37|SOV|1|
Nowosibirsk|55.03|82.92|SOV|1|
Stalinsk|53.76|87.11|SOV|0|
Taschkent|41.3|69.24|SOV|1|
Alma-Ata|43.24|76.95|SOV|0|
Krasnojarsk|56.01|92.87|SOV|0|
Irkutsk|52.29|104.3|SOV|1|
Tschita|52.03|113.5|SOV|0|
Chabarowsk|48.48|135.08|SOV|0|
Wladiwostok|43.12|131.89|SOV|2|P
Jakutsk|62.03|129.73|SOV|0|
Magadan|59.56|150.8|SOV|0|P
Petropawlowsk|53.02|158.65|SOV|0|P
Ulan-Bator|47.92|106.92|MON|0|c
Tokio|35.68|139.69|JAP|4|cuP
Osaka|34.69|135.5|JAP|3|uP
Nagoya|35.18|136.9|JAP|1|P
Hiroshima|34.39|132.46|JAP|1|P
Fukuoka|33.59|130.4|JAP|1|PL
Sendai|38.27|140.87|JAP|0|P
Sapporo|43.06|141.35|JAP|0|P
Toyohara|46.96|142.73|JAP|0|P
Keijo|37.57|126.98|JAP|1|P
Fusan|35.18|129.08|JAP|0|P
Heijo|39.02|125.75|JAP|0|
Taihoku|25.03|121.57|JAP|1|P
Okinawa|26.21|127.68|JAP|0|P
Iwojima|24.78|141.32|JAP|0|P
Saipan|15.19|145.75|JAP|0|kP
Truk|7.42|151.78|JAP|0|kP
Palau|7.34|134.48|JAP|0|kP
Kwajalein|8.72|167.73|JAP|0|kP
Dairen|38.91|121.6|JAP|1|P
Hsinking|43.88|125.32|MAN|1|c
Mukden|41.8|123.43|MAN|2|
Harbin|45.75|126.65|MAN|1|
Tschungking|29.56|106.55|CHI|2|c
Nanking|32.06|118.8|CHI|2|
Schanghai|31.23|121.47|CHI|3|uP
Peking|39.9|116.4|CHI|2|
Tientsin|39.13|117.2|CHI|1|P
Tsingtau|36.07|120.38|CHI|0|P
Hankau|30.58|114.27|CHI|2|
Kanton|23.13|113.26|CHI|2|P
Tschangscha|28.23|112.94|CHI|1|
Sian|34.27|108.94|CHI|1|
Tschengtu|30.66|104.07|CHI|0|
Kunming|25.04|102.71|CHI|1|
Lantschou|36.06|103.83|CHI|0|
Urumtschi|43.83|87.62|CHI|0|
Haikou|20.04|110.34|CHI|0|P
Lhasa|29.65|91.1|TIB|0|c
Kathmandu|27.7|85.32|NEP|0|c
Hongkong|22.3|114.17|ENG|1|kPL
Singapur|1.35|103.82|ENG|2|kPLIZ
Kuala Lumpur|3.14|101.69|ENG|0|kPI
Kuching|1.55|110.36|ENG|0|kP
Rangun|16.8|96.16|ENG|1|kP
Mandalay|21.97|96.08|ENG|0|k
Colombo|6.93|79.86|ENG|1|kP
Delhi|28.61|77.21|IND|2|c
Bombay|18.96|72.82|IND|2|uP
Kalkutta|22.57|88.36|IND|2|P
Madras|13.08|80.27|IND|1|P
Karatschi|24.86|67.01|IND|1|P
Lahore|31.55|74.34|IND|1|
Dacca|23.7|90.4|IND|0|
Imphal|24.82|93.95|IND|0|
Jamshedpur|22.8|86.2|IND|0|
Bangkok|13.75|100.5|SIA|1|cP
Saigon|10.82|106.63|FRA|1|kP
Hanoi|21.03|105.85|FRA|1|kP
Nouméa|-22.27|166.45|FRA|0|kP
Batavia|-6.2|106.82|NLD|2|kPIZ
Surabaja|-7.25|112.75|NLD|1|kPIZ
Palembang|-2.98|104.75|NLD|1|kPIZ
Medan|3.59|98.67|NLD|0|kPI
Balikpapan|-1.27|116.83|NLD|1|kP
Makassar|-5.15|119.43|NLD|0|kP
Hollandia|-2.53|140.72|NLD|0|kP
Port Moresby|-9.44|147.18|AST|1|kP
Rabaul|-4.2|152.17|AST|1|kP
Guadalcanal|-9.43|160.0|ENG|0|kP
Suva|-18.14|178.44|ENG|0|kP
Canberra|-35.28|149.13|AST|1|c
Sydney|-33.87|151.21|AST|2|P
Melbourne|-37.81|144.96|AST|2|P
Brisbane|-27.47|153.03|AST|1|P
Townsville|-19.26|146.82|AST|0|P
Darwin|-12.46|130.84|AST|0|PIZ
Perth|-31.95|115.86|AST|1|P
Adelaide|-34.93|138.6|AST|0|PIZ
Wellington|-41.29|174.78|NZL|1|cP
Auckland|-36.85|174.76|NZL|1|P
`;

// [Breite, Länge, Stahl (Kohle und Erz), Öl] – grobe Größenordnungen der dreißiger Jahre
export const RES_W: [number, number, number, number][] = [
  [40.44, -80.0, 50, 0], [41.88, -87.63, 30, 0], [33.52, -86.8, 10, 0], [46.79, -92.1, 20, 0], [43.65, -79.38, 6, 0],
  [29.76, -95.37, 0, 60], [36.15, -95.99, 0, 30], [34.05, -118.24, 0, 30], [10.65, -71.64, 0, 40], [22.25, -97.86, 0, 10],
  [10.65, -61.5, 0, 4], [7.1, -73.1, 0, 3], [-4.58, -81.27, 0, 3], [-45.86, -67.5, 0, 3], [26.2, 50.58, 0, 2],
  [-2.98, 104.75, 0, 14], [-1.27, 116.83, 0, 8], [3.59, 98.67, 0, 3], [20.46, 94.87, 0, 2], [53.57, 142.95, 0, 1], [4.4, 114.0, 0, 2],
  [53.76, 87.11, 10, 0], [33.59, 130.4, 10, 0], [41.8, 123.43, 8, 0], [22.8, 86.2, 6, 0], [-33.87, 151.21, 5, 0],
  [-25.75, 28.19, 3, 0], [-19.9, -43.9, 2, 0], [30.58, 114.27, 2, 0], [-11.66, 27.48, 4, 0], [39.02, 125.75, 3, 0],
];

// Industriekapazität je Staat für die neuen Provinzen (Deutsches Reich 1936 = 100)
export const IND_W: Record<string, number> = {
  USA: 290, CAN: 14, JAP: 35, MAN: 5, CHI: 6, IND: 6, AST: 6, NZL: 1, SAF: 3, SOV: 14, BRA: 4, ARG: 5, MEX: 3, CHL: 1.5,
  COL: 0.6, VEN: 0.6, PRU: 0.6, CUB: 0.5, SIA: 0.5, PER: 0.5, URU: 0.5,
};

// Heutiger Staat → Staat von 1936 (soweit nicht durch Sonderregeln bestimmt)
export const A3_W: Record<string, string> = {
  IND: 'IND', PAK: 'IND', BGD: 'IND', KAS: 'IND', NPL: 'NEP', BTN: 'NEP', MMR: 'ENG', LKA: 'ENG',
  SDN: 'ENG', SDS: 'ENG', SSD: 'ENG', KEN: 'ENG', UGA: 'ENG', TZA: 'ENG', ZMB: 'ENG', ZWE: 'ENG', MWI: 'ENG', BWA: 'ENG', LSO: 'ENG', SWZ: 'ENG',
  NGA: 'ENG', GHA: 'ENG', SLE: 'ENG', GMB: 'ENG', SOL: 'ENG', OMN: 'ENG', ARE: 'ENG', QAT: 'ENG', BHR: 'ENG', KWT: 'ENG', MYS: 'ENG', SGP: 'ENG',
  BRN: 'ENG', HKG: 'ENG', JAM: 'ENG', TTO: 'ENG', BHS: 'ENG', GUY: 'ENG', BLZ: 'ENG', FJI: 'ENG', SLB: 'ENG', EGY: 'ENG', JOR: 'ENG',
  YEM: 'YEM', ZAF: 'SAF', NAM: 'SAF',
  MRT: 'FRA', MLI: 'FRA', NER: 'FRA', TCD: 'FRA', SEN: 'FRA', GIN: 'FRA', CIV: 'FRA', BFA: 'FRA', BEN: 'FRA', TGO: 'FRA', CMR: 'FRA', GAB: 'FRA',
  COG: 'FRA', CAF: 'FRA', DJI: 'FRA', MDG: 'FRA', VNM: 'FRA', LAO: 'FRA', KHM: 'FRA', GUF: 'FRA', NCL: 'FRA', DZA: 'FRA', TUN: 'FRA', SYR: 'FRA',
  COD: 'BEL', RWA: 'BEL', BDI: 'BEL', AGO: 'POR', MOZ: 'POR', GNB: 'POR', TLS: 'POR', SAH: 'SPA', GNQ: 'SPA', ERI: 'ITA', SOM: 'ITA', LBY: 'ITA',
  ETH: 'ETH', LBR: 'LIB', IDN: 'NLD', SUR: 'NLD', USA: 'USA', PHL: 'USA', PRI: 'USA', GUM: 'USA', AUS: 'AST', PNG: 'AST', NZL: 'NZL', CAN: 'CAN',
  JPN: 'JAP', KOR: 'JAP', PRK: 'JAP', TWN: 'JAP', MNG: 'MON', THA: 'SIA', AFG: 'AFG', TKM: 'SOV', UZB: 'SOV', TJK: 'SOV', KGZ: 'SOV', KAZ: 'SOV',
  GEO: 'SOV', ARM: 'SOV', AZE: 'SOV', IRN: 'PER', IRQ: 'IRQ', SAU: 'SAU', TUR: 'TUR',
  MEX: 'MEX', GTM: 'GUA', SLV: 'SAL', HND: 'HON', NIC: 'NIC', CRI: 'COS', PAN: 'PAN', CUB: 'CUB', HTI: 'HAI', DOM: 'DOM', COL: 'COL', VEN: 'VEN',
  ECU: 'ECU', PER: 'PRU', BOL: 'BOL', BRA: 'BRA', PRY: 'PAR', URY: 'URU', ARG: 'ARG', CHL: 'CHL', ISL: 'DNK', GRL: 'DNK',
};

// Namen der Zeit statt der heutigen
export const RENAME_W: Record<string, string> = {
  Naypyidaw: 'Pyinmana', 'Đà Nẵng': 'Tourane', 'Da Nang': 'Tourane', 'Kota Kinabalu': 'Jesselton', Utqiagvik: 'Barrow', Daejeon: 'Taiden',
  'Mawlamyaing': 'Moulmein', Lianshan: 'Kintschou', Mumbai: 'Bombay', Chennai: 'Madras', Kolkata: 'Kalkutta', Yangon: 'Rangun',
  'Banda Aceh': 'Kutaradja', Kinshasa: 'Léopoldville', Maputo: 'Lourenço Marques', Harare: 'Salisbury', Astana: 'Akmolinsk',
  Bischkek: 'Frunse', Duschanbe: 'Stalinabad', 'Ho-Chi-Minh-Stadt': 'Saigon', Jakarta: 'Batavia', Wolgograd: 'Stalingrad',
};
