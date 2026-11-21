# Falkengrat

Ein First-Person-Bergwald in Three.js r180. Ein Gebirgsbach schlängelt sich zwischen Kiesbänken und Felsblöcken durch das Tal. Du kannst durch seine Furten waten und dem Waldpfad bis zum Aussichtspunkt folgen. Das Spiel benötigt einen Browser mit WebGL 2. Die fertige HTML-Datei enthält Code, Engine und Texturen und lässt sich offline öffnen.

## Steuerung

Am Handy spielst du hochkant. Mit dem Joystick links unten läufst du, rechts wischst du zum Umsehen. Ein kurzer Tipp rechts schwingt das Schwert. Tippe auf den Zielhinweis oben, um zu pausieren.

WASD oder Pfeiltasten zum Laufen, Maus zum Umsehen, Shift zum Sprinten und Leertaste zum Springen. Linksklick schwingt das Schwert, Rechtsklick pariert. Der Stumpf an der ersten Wegmarke dient als Übungsziel. Falls der Browser die Maus nicht einfängt, ziehe mit gedrückter linker Maustaste, um dich umzusehen.

Mit P wechselst du in den Fotomodus, mit M schaltest du den Ton um und mit Esc pausierst du. **Ruhige Kamera** deaktiviert das Wippen und die Bewegungsunschärfe. Die Tasten 1 bis 3 wechseln zwischen den Grafikprofilen. N wechselt zwischen Tag und Nacht. Die Tageszeit lässt sich auch im Menü unter **Grafik & Ton** einstellen. F3 zeigt Bildrate, Renderauflösung, Draw Calls und Dreiecke.

**Im Browser spielen:** https://tim-reuter13.github.io/falkengrat/ (WebGL 2, die Seite ist etwa 33 MB groß)

## Aus dem Quellcode bauen

```sh
npm ci
npm run build
```

Das Haupt- und Pausenmenü (`src/menu.css`, `src/menu.js`, Startbild `assets/menu-panorama.webp`) wird beim Build mit eingebettet. Öffne danach `dist/Falkengrat.html`. Der Build benötigt Node.js und die beiden fest versionierten npm-Abhängigkeiten. Zur Laufzeit sind kein Server und keine Netzwerkverbindung erforderlich.

## Rendering und Texturen

- Im Nahbereich bestehen die Bäume aus 3D-Stämmen und fein aufgelösten, gekreuzten 2D-Zweigen. Zwei PNG-Atlanten mit je 2048 × 2048 Pixeln enthalten jeweils acht Blickwinkel. Beim Umrunden eines Baums mischt der Shader benachbarte Winkel. Der Wechsel von der Nahgeometrie zum Impostor ist je nach Profil bei 22, 34 oder 43 Metern abgeschlossen. Das ferne LOD verwendet freigestellte Baumporträts. Die Kronen werfen Schattensilhouetten aus den Atlanten.
- Handschuh und Ärmel teilen sich ein gewichtetes GLB-Mesh mit beweglichem Handgelenk. Das Schwert ist ein zweites GLB-Mesh. Beide enthalten Farb-, Normal-, Rauheits- und Metalltexturen. Die polierte Klinge spiegelt eine HDR-Cubemap der Umgebung, die während des Spiels abschnittsweise aktualisiert wird.
- Drei Gruppen texturierter 3D-Vögel kreisen über dem Tal, während weitere Vögel auf Felsen sitzen. Sie reagieren auf Annäherung, Sprint und Schwertbewegung. Schulter- und Flügelgelenke, Schwanz, Beine und Kopf ändern ihre Haltung beim Auffliegen, Gleiten und Landen.
- Jedes Grasbüschel besteht aus zwölf Halmen. Die Halme folgen der Bodenneigung. Ihr Ansatz blendet über etwa zehn Zentimeter in Farbe und Beleuchtung aus dem Bodenpass über. Freiliegende Wurzeln und umgestürzte Bäume haben verzweigte 3D-Geometrie. Aufgewühlte Stellen formen das Gelände und enthalten dunkle Erde, Erdklumpen und gespaltene Hufabdrücke.
- Acht zusätzliche Materialschichten bringen Humus, Buchenlaub, Polstermoos, verdichtete Erde, trockenen Rundkies, nasses Geröll, Schlick und Schieferschutt auf den Boden. Versetzte und gedrehte Farb- und Normalproben lockern die Wiederholungen auf. Die Auflösung des Geländes reicht von 40 Zentimetern am Weg bis 3,2 Metern in der Ferne. Felsen folgen der Hangneigung und erhalten Kontaktschatten unter ihrer Auflagefläche. Gesägte Holzflächen zeigen Jahresringe.
- Pilze, Rindenstücke, Wurzeln, Bucheckern, Flechten, Seggen, Laubzweige und morsches Holz ergänzen die instanzierten Bodenobjekte. Farn und Bodenobjekte empfangen Szenenlicht und Schlagschatten. Die Materialshader dämpfen eingebackene Spitzlichter, damit die Texturen im Schatten dunkler wirken.
- Acht Waldmotive ergänzen Sauerklee, Heidelbeersträucher, Brennnesseln, Walderdbeeren, Glockenblumen, kleine weiße Waldblüten, Baumpilze und Schneckenhäuser. Acht Bachmotive ergänzen Binsen, Schachtelhalm, Sumpfdotterblumen, Bach-Vergissmeinnicht, Wasserminze, Wasserhahnenfuß, Laichkraut und Fadenalgen. Standort, Strömung und Wassertiefe steuern ihre Verteilung. Die Blattflächen empfangen Schlagschatten. Zusätzlich passt ein verkleinerter Bodenpass ihre Helligkeit an die Beleuchtung am Stielansatz an.
- Vier weitere sichtbare Details beleben den Bach. Blätter treiben in der Strömung, Sonnenlicht zeichnet Kaustiken auf den flachen Bachgrund, feuchte Steine zeigen einen dunklen Saum an der Wasserlinie und kleine Mückenschwärme bewegen sich an geschützten Uferstellen.
- Der Bach berechnet seine lokale Fließrichtung entlang des Flussbetts. Eine 2048 × 2048 große, prozedural erzeugte Schaumtextur enthält Blasenfilme und aufbrechende Schaumflecken auf mehreren Skalen. Die sichtbaren Wasserlinien der Steine bestimmen die Startpunkte von Spritzfächern, Tropfen und Gischt. Beim Waten steigen die Stärke der Kielspur und die Menge der Fußspritzer mit Tempo und Wassertiefe.
- Eine kapselförmige Spielfigur gleitet an den Dreiecken der Felsen, Stümpfe und Treibholzstücke entlang. Bodenkontakt, Landungen und Schwerttreffer verwenden dieselbe Geometrie. Ein räumlicher Index beschränkt die Prüfung auf nahe Oberflächen.
- Eine optionale kurze Bewegungsunschärfe rekonstruiert die Bildschirmbewegung anhand der Tiefenwerte und der vorherigen Kameramatrix. Die maximale Länge beträgt 4,5 interne Bildpunkte.
- Der Himmel berechnet mehrere Schichten prozeduraler Wolkendichte. Sonnenstrahlen und Kontaktschatten lesen den Tiefenpuffer in einem verkleinerten Renderpass. Die Strahlen orientieren sich an der Tiefenmaskierung im lokal geprüften Sunbathing v1.14.
- Unter den Kronen fallen Lichtbahnen schräg entlang der Sonnenrichtung bis zum Boden. Über dem Bach und in feuchten Senken liegt flacher Dunst. In der Luft schweben Staubkörnchen, die nur im Gegenlicht vor dunklem Hintergrund aufleuchten. Alle drei Effekte blenden über die lineare Tiefe weich in die Szene. Zusätzlich zeichnet der Geländeshader ein bewegtes Kaustiknetz auf flachen Bachgrund. Die Techniken sind vom Minecraft-Paket Visual Effects+ inspiriert, aber vollständig prozedural umgesetzt.
- Nachts steht der Mond dort, wo tagsüber die Sonne steht. Dadurch bleiben Schattenrichtung und Schattenkarte gleich. Kaltes Mondlicht, ein dunkler Himmel mit Sternen und Mondhof sowie dunkler Dunst ersetzen das Tageslicht. Die Belichtung steigt wie bei einem an die Dunkelheit gewöhnten Auge. Eine Nachtsicht-Abstufung nimmt den Farben die Sättigung und verschiebt sie ins Blaue. Der Dunst über dem Bach wird dichter und fahler, und durch die Kronen fallen nur schwache Mondbahnen. Der Übergang dauert etwa drei Sekunden.
- Temporales Anti-Aliasing verschiebt die Projektion pro Bild um einen Subpixel-Versatz und mischt das Ergebnis mit dem reprojizierten Vorbild. So beruhigen sich Nadeln, Gras und Dither-Übergänge.
- Die Auflösung passt sich an Bildrate und gemessene GPU-Zeit an. Hat die Grafikkarte Reserven, rendert das Spiel über 100 %: bis zur Pixeldichte des Bildschirms, im Profil Cinematic zusätzlich mit Supersampling. Die Grafikprofile regeln außerdem Dichte und Reichweite der Vegetation, Baum-LOD, Wolkenschritte, Strahlensamples und Schatten.

Die Bildvorlagen aus dem integrierten ImageGen und ihre Prompts liegen unter `assets/originals`. `python tools/prepare-textures.py` bereitet die ursprünglichen Bäume und Materialien auf. `python tools/prepare-forest-update.py` verarbeitet Panoramen, Pflanzen und Oberflächen. `python tools/build-equipment.py` erzeugt die GLB-Modelle und das Gefieder. `python tools/prepare-river-assets.py` erzeugt Bodenmaterialien, den Objektatlas und das Stirnholz. `python tools/prepare-habitat.py` baut den Atlas für Wald- und Bachpflanzen. `python tools/bake-foam.py` berechnet die Schaumtextur. Die fertigen Modelle und Texturen liegen in `assets`.

`npm run build:bake` baut eine Variante, die die Impostors aus der Baumgeometrie rendert. Starte sie mit `?dev` an der URL. `window.falkengrat.atlas()` gibt die PNG-Daten-URLs für `assets/impostor-fir.png` und `assets/impostor-spruce.png` in dieser Reihenfolge aus.
