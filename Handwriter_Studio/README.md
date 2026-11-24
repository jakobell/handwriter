# Handwriter Studio 7.0

Eine statische Webanwendung mit zwei integrierten Ansichten: Schriftstudio (135 Zeichen, je fünf Varianten) und Handwriter (JSON-Profil und Dokument). Keine Anmeldung, kein Backend, kein Build, keine CDN-Abhängigkeiten. Alle Dateien werden im Browser verarbeitet. Die mitgelieferte PDF.js-Version enthält die Korrektur für zugeschnittene PDF-Textbereiche aus V6.1.

## Hosting

**Webroot / Publish directory: `docs/`**. Der Inhalt dieses Verzeichnisses ist die vollständige Website. `index.html` ist der Einstieg. Die relative Verzeichnisstruktur unverändert lassen; keine einzelnen HTML-Dateien getrennt veröffentlichen. HTTPS empfohlen. Der Host muss `.js` und `.mjs` mit JavaScript-MIME-Type ausliefern. Keine serverseitigen Schreibrechte nötig.

### GitHub Pages
1. Neues Repository erstellen, Projekt entpacken und dessen Inhalt committen.
2. Settings → Pages → Build and deployment: Deploy from a branch.
3. Branch `main`, Verzeichnis `/docs` auswählen, speichern.
4. Die von Pages angezeigte URL an Kolleginnen und Kollegen schicken. Keine personenbezogenen Dateien in das Repository committen.

### Netlify (statischer Upload)
Den Ordner `docs` als statische Website bereitstellen. Bei Git-Deployment ist `netlify.toml` bereits konfiguriert. Für sonstige Webserver den Inhalt von `docs` in das gewünschte Webverzeichnis kopieren.

### Lokal ausprobieren
Windows: `START.bat` ausführen; Linux/macOS: `./start.sh` (Python 3 erforderlich, nur als lokaler statischer Server). Dann `http://localhost:8000` öffnen. Nicht per Doppelklick auf `index.html` starten, da Browser Module/Worker bei file:// einschränken. Der lokale Server ist absichtlich nicht im Netzwerk erreichbar. Für Kolleginnen und Kollegen einen echten HTTPS-Host verwenden.

## Ablauf
- Schriftstudio öffnen, Zeichen zeichnen (auch Finger/Touch), bei Bedarf überspringen. Nach jedem abgeschlossenen Strich, Löschen, Undo und Zeichenwechsel wird gespeichert.
- Die Oberfläche stellt die Position, Striche und Breite nach einem erneuten Besuch wieder her. LocalStorage wird sofort beschrieben, IndexedDB erhält zusätzlich eine Kopie. Die jüngere Version wird geladen. Speicherfehler werden angezeigt. Das ist keine Cloud-Synchronisierung und kein garantierter Schutz gegen das Löschen von Browserdaten. Nur einen Schriftstudio-Tab gleichzeitig bearbeiten.
- `JSON exportieren`/`JSON-Sicherung` speichert ein normalisiertes V3-Vektorprofil **mit Originalstrichen und Bearbeitungsposition**. Über `JSON laden` lässt es sich auf einem anderen Gerät fortsetzen. Bestehende v2/v3-Profile mit bis zu fünf Varianten können ebenfalls geladen werden.
- `Im Handwriter verwenden` übernimmt die aktuelle Schrift direkt in dessen IndexedDB. Alternativ vorhandene JSON-Datei importieren. Kein Foto-, Scan- oder SVG-Datei-Upload für Schriftprofile; Vektorpfade sind im JSON enthalten. Alte Raster-JSONs können im Handwriter näherungsweise vektorisiert werden.
- Dokument auswählen (PDF, DOCX, Markdown, TXT oder Text), Layout und Stift einstellen, schreiben und PDF herunterladen. PDF-Export ist gerastert (Vektorprofile bleiben Vektoren). Fehlende Zeichen werden durch eine Ersatzschrift dargestellt. Original-Layout erhält Tabellen und Grafiken; Reflow bricht Text um. Squeeze begrenzt die Zielseitenzahl, ggf. wird Schrift sehr klein. Bild-PDFs benötigen zuvor OCR.

## Datenschutz / Grenzen
Keine Profile, PDF-Dateien, Zeichnungen oder Beispielunterlagen von anderen Personen sind enthalten. Das Hosting liefert nur die statischen Dateien aus; es gibt keinen Datei-Upload an den Server. Jeder Browser/Browserprofil hat eigenen Speicher je Origin. Auf gemeinsam genutzten Rechnern Browserprofile trennen. Bei Wechsel von Domain, Port, Browser oder Gerät muss ein JSON-Backup mitgenommen werden. Im Privatmodus oder bei Speicherbereinigung kann Fortschritt verloren gehen. Browser/Host können gewöhnliche Zugriffslogs führen. Die Anwendung hat keine serverseitige Benutzerverwaltung. Vor Verwendung bei Prüfungen die geltenden Hilfsmittelregeln beachten.

## Tests
`npm test` (Node.js 22 empfohlen, keine npm-Pakete notwendig) führt die sechs automatisierten Suites aus: Capture/Reload, Vektoren, Normalisierung, PDF-Clip, Layout und Squeeze. Der Browser-End-to-End-Test war in der Erstellungsumgebung wegen einer Browser-Sicherheitsrichtlinie blockiert; auf Zielhost kurz manuell prüfen: zeichnen → Seite aktualisieren → weiterzeichnen → Profil übernehmen → PDF exportieren. Physischer Surface-Test ausstehend.

Lizenz: siehe LICENSE und docs/vendor/pdfjs/LICENSE. Upstream-Hinweise siehe README_UPSTREAM.md.
