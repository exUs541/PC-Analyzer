# PC-Analyzer (LaptopCheck) – Benutzerhandbuch

Dieses Handbuch beschreibt die Windows-App **LaptopCheck** aus dem Repository *PC-Analyzer* aus Anwendersicht. Die technische Sicht steht in [architecture.md](architecture.md), der Überblick in der [README](../README.md).

Alles läuft **lokal auf deinem Rechner**. Die Scans **lesen nur**; verändert wird erst, wenn du es ausdrücklich bestätigst, und alles Gelöschte landet im **Papierkorb**.

## Installieren und starten

1. `LaptopCheck-win-Setup.exe` aus dem [neuesten Release](https://github.com/exUs541/PC-Analyzer/releases/latest) starten. Die Installation gilt nur für deinen Benutzer, braucht **keine Administratorrechte** und legt Verknüpfungen auf dem Desktop und im Startmenü an. Das Setup bringt .NET mit (rund 80 MB); vorinstalliert sein muss nichts. *Hinweis:* Der Installer ist nicht signiert, Windows zeigt deshalb „SmartScreen“: *Weitere Informationen → Trotzdem ausführen*.
2. Beim ersten Start scannt die App von selbst (ca. 1–2 Minuten) und zeigt danach das Dashboard in einem eigenen Fenster.
3. Beim nächsten Start siehst du sofort die letzten Messwerte; **„Neu scannen“** (oben rechts) liest alles frisch ein. Ein Scan pro Woche reicht.

**Mehr Details mit Administratorrechten:** Die App einmal mit Rechtsklick → *Als Administrator ausführen* starten. Dann kommen SSD-Verschleiß und -Temperatur, BitLocker, TPM und der Prefetch-Verlauf („zuletzt benutzt“ für Hintergrundprogramme) dazu. Der Scan bleibt auch dann rein lesend.

**Updates:** Die installierte App prüft jede Stunde auf eine neue Version, lädt sie im Hintergrund (meist nur ein kleines Delta) und installiert sie beim Beenden. Im Dashboard erscheint oben „Neue Version … ist geladen“ mit „Jetzt neu starten“; bleibt das Fenster zwei Minuten unbenutzt und läuft nichts, startet die App von selbst in die neue Version. Ausschalten: *Einstellungen → automatische Updates*.

**Demo ohne eigenen Scan:** Mit erfundenen Daten kannst du alles ausprobieren, siehe README, Abschnitt „Demo“.

## Die Seiten

Links steht das Menü mit fünf Einträgen; Seiten, die zusammengehören, haben oben eine Reiterleiste.

| Menü | Seiten und Inhalt |
|---|---|
| **Start** | Gesamtwert (0–100) mit Erklärung der Abzüge, Status je Bereich, die drei wichtigsten nächsten Schritte, Änderungen seit dem letzten Scan, Verlauf (freier Platz, RAM, Akku …), *Balance-Check* (welcher Teil bremst am meisten) |
| **Aufgaben** | *Zu erledigen:* alle Befunde mit konkreter Handlungsempfehlung (Schritt für Schritt), abhaken, ignorieren, eigene Aufgaben. *Aufräumen:* alles, was zum Entfernen markiert ist, mit Begründung und betroffenen Objekten. |
| **Mein PC** | *Programme* (Name, Herausgeber, Datum, zuletzt benutzt, Größe, Empfehlung), *Hardware* (Gerät, Windows, Prozessor, Arbeitsspeicher mit jedem Modul, Speicher, Grafik, Akku, Netzwerk, Sicherheit), *Speicher* (wo ist der Platz geblieben), *Dateien & Cloud*, *Inventur*, *Hausordnung*, *Ordnen*, *Ordner vergleichen*, *Upgrade-Tipps* |
| **Projekte** | Deine Projekte mit allem, was du dafür brauchst (Programme, Systeme, Dateien, Hardware, Konten), und deine GitHub-Repositories samt lokalen Klonen |
| **Einstellungen** | Scan-Details und Datenlücken, Updates, Sicherung deiner Angaben, Diagnose; *Prüfen* sammelt Einträge, die du mit „⚑ Wichtig – bitte prüfen“ markiert hast |

Jeder Block lässt sich mit dem Pfeil rechts oder einem Klick auf seine Überschrift **einklappen**; eingeklappt bleibt eingeklappt.

### Beispiel: „Mein RAM sagt 48 GB, aber …“

Unter *Mein PC → Hardware → Arbeitsspeicher* stehen drei Zahlen nebeneinander: **verbaut** (Summe der Module), **von Windows nutzbar** und **was dir versprochen wurde** (trägst du selbst ein). Weicht etwas ab, nennt das Tool mögliche Ursachen und was du prüfen kannst (z. B. Speicherlimit in `msconfig`, BIOS-Einstellung, Modul nicht richtig eingesetzt, aufgelöteter Anteil).

### Direkt zur richtigen Stelle

Bei Befunden, die du in Windows selbst erledigen musst, sitzen Knöpfe wie „Autostart-Einstellungen öffnen“, „Task-Manager öffnen“, „Windows Update öffnen“ oder „Speicher-Einstellungen öffnen“. Ein Browser darf keine Programme starten, der lokale Server schon, aber **nur eine feste Liste** harmloser Windows-Werkzeuge und Einstellungsseiten (`OpenTargets.cs`); alles andere wird abgelehnt. Beim Befund „Programm-Updates verfügbar“ startet „Jetzt alle aktualisieren“ `winget` in einem eigenen Fenster, nach einer Liste dessen, was aktualisiert wird.

---

## Deine Angaben

Alles, was du einträgst (Zweck, Beschreibung, Entscheidungen, Aufgaben), liegt in `data\notes.json` (Sicherung daneben: `notes.json.bak`). Die Datei bleibt bei neuen Scans und Updates des Tools erhalten. Unter *Daten* kannst du sie exportieren/importieren. Eigene Texte haben **immer Vorrang** vor automatisch erkannten Werten und lassen sich pro Feld zurücksetzen.

Weitere Dateien in `data\`: `space.json` (letzte Speicher-Analyse, siehe unten), `snapshot.json` (letzter Scan), `snapshot.prev.json` (der davor, für „Seit dem letzten Scan“), `history.json` (Verlauf), `files.json` (Dateien-Scan), `projects.json`, `repos.json`, `config.json`, `cleanup.json` (Aufräumliste + Bestätigungen), `cleanup-log.jsonl` (Protokoll gestarteter Entfernungen), `moves\` und `deletes\` (Protokolle der Umzüge/Papierkorb-Läufe). Sie enthalten u. a. Rechner- und Benutzername sowie die Seriennummer – teile sie nicht ungeprüft.

---


---

## Aufräumen: Entfernen nur nach deiner Bestätigung

1. **Markieren** – du setzt ein Programm in der Software-Liste auf „✖ Entfernen“, übernimmst einen Vorschlag des Tools (unerwünschte/veraltete/lange ungenutzte Programme, Installer-Ordner, lokale Kopien von Dateien, die schon in der Cloud liegen, `node_modules` alter Projekte, Reste längst entfernter Programme) oder merkst von Hand einen Pfad vor. Das ändert **nichts** am PC.
2. **Prüfen & bestätigen** – zu jedem Objekt zeigt LaptopCheck *wie und wo es verwendet wurde* (zuletzt benutzt, Starts, Vordergrundzeit, Zweck) und *was sonst betroffen ist*, jeweils mit Einordnung: *funktioniert danach nicht mehr* (Projekte, abhängige Programme), *deine Daten* (z. B. 214 `.blend`-Dateien ohne Kopie in der Cloud), *eingeschränkt*, *danach überflüssig* (Begleitprogramme, die nur dafür da waren – nur wenn nicht noch andere Programme sie brauchen), *Rest bleibt liegen* (Datenordner in `AppData`). Begleit-Objekte kannst du mit einem Häkchen **ebenfalls auf die Liste** setzen; auch sie werden danach einzeln bestätigt. Ohne ausdrückliches Häkchen „Ich habe … gelesen“ geht es nicht weiter.
3. **Entfernen starten** – *Programme:* das **eigene Deinstallationsprogramm** des Herstellers öffnet sich (nie still im Hintergrund) und fragt noch einmal. *Dateien/Ordner:* ein Fenster listet alles auf; erst nach Eintippen von `ENTFERNEN` geht es in den **Papierkorb** (wiederherstellbar). Der Server führt nur aus, was er selbst aus der gespeicherten Bestätigung und dem letzten Scan zusammensetzt – nie, was die Seite schickt.
4. **Neu scannen** – danach siehst du, ob es wirklich weg ist; erledigte Objekte wandern in den Verlauf.

**Hintergrund-Programme** (Cloud-Sync wie Google Drive, Datensicherung, Treiber von Zeichentabletts) laufen ohne sichtbare „Starts“. Sie gelten nie als „selten genutzt“, ihr Autostart wird nicht zum Abschalten empfohlen; „zuletzt benutzt“ ist bei Cloud-Clients die letzte Änderung im Cloud-Ordner (nach einem Dateien-Scan).

**Unplausible Größen:** Manche Installer tragen die Größe in Bytes statt Kilobytes ein – ein 62-MB-Treiber erscheint dann als „62 GB“. Der Scan misst bei Angaben über 2 GB den Installationsordner nach und übernimmt die Messung, wenn sie weit abweicht („korrigiert“). Was sich nicht prüfen lässt und für Treiber/Hilfsprogramme unmöglich groß ist, wird als „unplausibel“ markiert und in keiner Summe mitgezählt.

**Geschützt** (wird vom Server unabhängig von dem verweigert, was die Oberfläche schickt): Windows- und Programme-Ordner, `AppData\*\Microsoft`, Cloud-Ordner (ein Löschen dort würde auch die Cloud-Kopie löschen), dein Benutzer- und die Standardordner selbst, `.ssh`, Ordner **mit Git-Repositories**, Verknüpfungen/Junctions und alles, was sich nach deiner Bestätigung geändert hat. Jeder Start wird in `data\cleanup-log.jsonl` protokolliert.

Grenzen: Welche Datei zu welchem Programm gehört, ergibt sich aus Windows’ Dateityp-Zuordnung, Ordnernamen und einer eingebauten Liste häufiger Programme (`LC.RELATIONS` in `web/knowledge.js`) – das sind **Hinweise**, mit Genauigkeit (*sicher / wahrscheinlich / möglich*) gekennzeichnet. Für Dateien und Datenordner braucht es den Dateien-Scan.


## Inventur: „Woher kommt dieser Ordner?“

*Mein PC → Inventur.* Programme, Entwicklerwerkzeuge und Downloads legen Ordner dort an, wo man nie hinsieht. Die Inventur nutzt den Dateien-Scan (rein lesend) und erklärt jeden Ordner: **zu welchem Programm er gehört, wann darin zuletzt etwas geändert wurde** (die neueste Datei, nicht das Datum des Ordners) und **was damit zu tun ist**.

* **Orte:** Programmdaten (`AppDataLocal`, `AppDataRoaming`, `ProgramData`, versteckte Ordner im Benutzerverzeichnis) sowie die Hauptordner von `C:`, Programm-Ordner, `AppDataLocalPrograms`, `LocalLow` und eigene Ordner im Benutzerverzeichnis. Cloud-Ordner, die wirklich synchronisiert werden, zählen nicht als „unbekannt“.
* **Einstufung:** *aktiv* (Programm da, Ordner innerhalb eines Jahres benutzt), *ungenutzt* (Programm da, aber seit über einem Jahr nichts darin geändert), *Cache* (baut sich selbst neu auf), *Rest* (kein Programm braucht ihn mehr: nicht installiert, deinstalliert, alter Drive-Spiegel), *vermutlich Rest* (kein Programm passt und seit über einem Jahr unberührt), *unbekannt* (kein Programm passt, aber jung). Jede Einstufung nennt ihre Gründe („Warum diese Einstufung?“) und ihre Sicherheit (sicher / wahrscheinlich / möglich).
* **Zuordnung:** erst eine Tabelle bekannter Werkzeug-Ordner (`.gradle`, `.android`, `npm-cache` …, `LC.FOLDER_TOOLS` in `web/folders.js`), dann die Wissensbasis der Programme, der Installationsordner der Programme und zuletzt der Name bzw. Herausgeber installierter Programme.
* **Nach der Deinstallation:** Verschwindet ein Programm zwischen zwei Scans, merkt sich LaptopCheck Name und Datum (`notes.json → removedApps`). Seine Ordner gelten dann als **sicherer Rest** und stehen oben unter „Nach deiner Deinstallation übrig geblieben“ und als Aufgabe. Wird das Programm wieder installiert, ist es nicht mehr „entfernt“.
* **Handeln:** „Im Explorer zeigen“, „Zum Aufräumen vormerken“ (dann gilt die normale Aufräum-Prozedur: jedes Objekt einzeln bestätigen, Papierkorb) und „Behalten“ (der Ordner taucht nicht mehr unter „Zu prüfen“ auf). Programm-Ordner (Program Files) fasst das Tool nicht an; dort verweist es auf Windows → Apps. Die Registry bleibt unberührt.

Technik: `FilesScan.Places` (neue Orte) und `FilesScan.DataDirs` liefern je Ordner Größe, Anlegedatum und die Änderungszeit der **neuesten Datei** (`files.json → dataDirs`, `places`); die Einordnung steht als lesbarer Code in `web/folders.js`. Test mit Beispielen von einem echten Laptop: `tests/folders.test.js`.


## Hausordnung: „Was bleibt, was zieht um, was kann weg?“

*Mein PC → Hausordnung.* Der PC soll nur behalten, was du brauchst; Altes liegt im gestreamten Google Drive (kostet dort fast keinen Platz) oder ist weg. Die Hausordnung sortiert deine Hauptordner (Dokumente, Desktop, Bilder, Videos, Downloads) nach **deinen Regeln** und baut daraus einen **Spar-Plan**:

* **Regeln (du stellst sie ein):** nach wie vielen Tagen ohne Änderung ein Ordner als „alt“ gilt (Standard 180; für Downloads 60), ab welcher Größe sich das lohnt (100 MB), wie der Archiv-Ordner im Drive heißt (`99_Archiv`) und welche Ordner **immer lokal** bleiben („Lokal behalten“). Gemessen wird die neueste Datei im Ordner, nicht das Datum des Ordners. Eine Änderung wirkt sofort.
* **Nach Google Drive:** alte Ordner mit eigenem Inhalt, vorgeschlagenes Ziel `Archiv/Jahr/Ordnername` (änderbar). „In den Umzugsplan übernehmen“ merkt sie nur vor; den eigentlichen Umzug startest du unter *Dateien & Cloud* – kopieren, jede Datei per SHA-256 prüfen, warten, erst nach deiner Bestätigung Originale in den Papierkorb.
* **Kann weg:** Ordner und Dateien, die **schon in der Cloud liegen** (Name + Größe gleich), sowie alte **Installer** (`.exe`, `.msi`, `.iso` …). **Archive** (`.zip`, `.7z`, `.rar`) schlägt die Hausordnung nie zum Löschen vor, weil darin Eigenes stecken kann: Ordner voller Archive wandern ins Drive-Archiv, einzelne Archive stehen unter „Selbst ansehen“ (nur Pakete, die nach Programm aussehen, z. B. `Tool-1.2.3-win-x64.zip`, gelten als Installer). „Vormerken“ setzt sie nur auf die Aufräumliste: jedes Objekt einzeln bestätigen, Papierkorb.
* **Selbst ansehen:** Code gehört erst in ein Git-Repository (GitHub); einzelne große lose Dateien verschiebt der Umzug nicht (er arbeitet mit Ordnern).
* **Spar-Plan:** alle Wege, Speicher zurückzuholen, mit Größe und Link: Hausordnung, alter Google-Drive-Ordner, Reste und Caches aus der Inventur, ungenutzte Programme (Näherung). Die Posten liegen an verschiedenen Orten und werden nicht doppelt gezählt; unter 50 MB wird ein Posten weggelassen.
* **Alter Drive-Ordner (Abgleich):** Liegt neben einem gestreamten Drive (z. B. `G:\Meine Ablage`) noch ein alter Spiegel-Ordner (`C:\Users\du\My Drive`), vergleicht der Dateien-Scan **jede Datei** beider Ordner (relativer Pfad + Größe, nur lesend; `LeftoverCompare.cs`, höchstens 150 s). Ergebnis: wie viel schon unverändert im Drive liegt (dann ist die lokale Kopie überflüssig), wie viel nur mit Name + Größe an anderer Stelle im Drive liegt, und **welche Dateien nur hier liegen** – mit Ordner und Größe. Die fehlenden Dateien kopierst du in den gleichen Unterordner im Drive, scannst neu und legst den alten Ordner dann im Explorer in den Papierkorb. Das Tool selbst löscht in Cloud-Ordnern nichts, damit nie etwas aus dem Drive verschwindet. Verknüpfungen (`.gdoc` …), `desktop.ini` und Drives Temp-Ordner zählen nicht als Inhalt.
* **Empfehlung per Klick umsetzen:** Oben auf der Seite steht „Meine Empfehlung“ mit **„Alles umsetzen“** und je Schritt einem **„Jetzt umsetzen“**. Ein Fenster listet vorher genau, was passiert (Anzahl, Größe, Ordner). Die Schritte: (1) **Fehlende Dateien ins Drive kopieren** (`POST /api/restore/start`, `RestoreJobs.cs`): Die Seite schickt keinen Pfad, beide Ordner kommen aus der Cloud-Erkennung; jede Datei geht an denselben relativen Pfad im Drive, **nichts wird überschrieben**, jede Kopie wird per SHA-256 zurückgelesen und bei Abweichung wieder entfernt, der alte Ordner bleibt unverändert; danach startet ein neuer Dateien-Scan. (2) **Alte Ordner ins Drive-Archiv kopieren**: der bekannte geprüfte Umzug von „Dateien & Cloud“; die Originale bleiben, bis du sie dort entfernst, nachdem Drive „synchronisiert“ meldet. (3) **Installer und Kopien in den Papierkorb**: Die Einträge werden auf die Aufräumliste gesetzt und bestätigt, der Server prüft sie erneut, und Windows öffnet **sein eigenes Fenster, in dem du einmal ENTFERNEN tippst** – erst dann geht etwas in den Papierkorb. Auf der Seite „Speicher“ gibt es dasselbe als **„Unkritisches aufräumen“** für Caches in deinem Benutzerordner (nicht Temp-Ordner, nicht ProgramData, nicht Ordner außerhalb des Profils). Den alten Drive-Ordner selbst löscht das Tool nicht (Cloud-Schutz; er enthält ein Git-Repository).
* **Nichts passiert von selbst.** Cloud-Ordner, Windows und Programme fasst die Hausordnung nicht an. Es gibt Aufgaben („Hausordnung: … nach Google Drive“) und kurze Gewohnheiten, damit sich nichts mehr ansammelt. Die Regeln stehen in `config.json → house`; die Logik in `web/house.js`, Test: `tests/house.test.js`.


## Ordner vergleichen

*Mein PC → Ordner vergleichen.* Zwei beliebige Ordner (zwei Drive-Stände, ein Backup und das Original, zwei Projektordner …) gegeneinander: Du wählst Ordner A und B (Eingabefeld, „Wählen …“-Fenster oder Schnellwahl; mit einem Klick „Alten und neuen Google Drive“) und siehst **in einem Satz**, was der Unterschied ist („Alles aus A ist auch in B, B hat zusätzlich …“), darunter fünf Zahlen: **gleich**, **nur in A**, **nur in B**, **verschieden** (in beiden, aber andere Größe bzw. anderer Inhalt) und **verschoben** (gleicher Name und gleiche Größe an anderer Stelle: umbenannter oder umgezogener Ordner, kein echter Unterschied).

* **Wo ist der Unterschied?** Standardansicht ist ein Ordner-Baum, der nur Ordner mit Unterschieden zeigt; jede Zeile zählt alles darunter mit. Dazu je eine Liste mit Suche (Pfad, Größe, Datum, „Im Explorer zeigen“) und **„Unterschiede als CSV speichern“** für Excel.
* **Nur lesend.** Gelesen werden Namen, Größen und Änderungsdaten; geändert, kopiert oder gelöscht wird nichts (`FolderCompare.cs`, Test: nichts im Ordner ändert sich). Optional **„Auch den Inhalt prüfen“**: Dateien mit gleicher Größe werden per SHA-256 verglichen (langsamer; auf einem Cloud-Laufwerk wie `G:` werden sie dafür heruntergeladen).
* Verglichen wird nach **relativem Pfad** (Groß-/Kleinschreibung egal). Verknüpfungen (Junctions, Symlinks) werden nicht verfolgt; `desktop.ini`, Drive-Verknüpfungen (`.gdoc` …) und Office-Sperrdateien sind abschaltbar ausgenommen. Zeitgrenze 4 Minuten (dann steht „Zahlen sind Mindestwerte“); die Listen zeigen höchstens 5000 Einträge, die Zahlen sind vollständig. Ein Ordner darf nicht im anderen liegen.
* Das letzte Ergebnis bleibt in `data\compare.json` und ist beim nächsten Öffnen der Seite wieder da. Auf dem Test-Laptop vergleicht der alte mit dem neuen Drive (140.000 Dateien) in rund 10 Sekunden.

Technik: `POST /api/compare` {a, b, deep, ignoreJunk}, `GET /api/compare/last`, `POST /api/pick-folder` (Windows-Fenster, nur in der App). Logik der Anzeige: `web/compare.js`, Tests: `tests/compare.test.js`, `FolderCompareTests.cs`.


## Speicher-Analyse: „Wo ist der Speicher geblieben?“

*Mein PC → Speicher → „Speicher analysieren“* (nur in der App-Version; dieselbe Analyse steht auch unter *Hardware → Speicher*). Der normale Scan misst nur eine feste Liste bekannter Ordner; die Analyse liest **einmal alle Ordner des Systemlaufwerks** (rein lesend, meist unter einer Minute, höchstens 2,5 Minuten) und erklärt die größten Posten:

* **Was ist es?** Jeder große Ordner wird einer Gruppe zugeordnet: Spiele (Steam, Epic), Entwicklung (Unreal, Unity, Android, Visual Studio …), Caches & Reste (Shader-Cache, npm, Gradle, Temp, Update-Reste), Cloud-Ordner (lokal gespiegelt), Eigene Dateien, Programme & Programmdaten, Windows & System.
* **Kann es weg?** *unkritisch* (baut sich selbst neu auf oder sind Reste), *du entscheidest* (ein Spiel, ein Programm, deine Dateien) oder *gehört zu Windows*. Zu jedem Posten steht, **wie** man es entfernt (z. B. „In Steam deinstallieren“, „über den Unity Hub entfernen“, „Drive auf ‚Dateien streamen‘ umstellen“, `powercfg /hibernate off` für die Ruhezustandsdatei).
* **Zahlen, die aufgehen:** Ein Ordner steht entweder als Ganzes oder aufgeteilt in seine Teile (plus „übrige Dateien“) – nichts wird doppelt gezählt. Darunter stehen „viele kleine Dateien“ und der Teil, der **ohne Administratorrechte nicht lesbar** ist (Wiederherstellungspunkte, Store-Apps).
* **Direkt handeln:** „Im Explorer zeigen“, und bei unkritischen Ordnern „Zum Aufräumen vormerken“ (dann gilt die normale Aufräum-Prozedur: jedes Objekt einzeln bestätigen, Papierkorb). Windows- und Programmordner lassen sich nicht vormerken.
* Der Befund „Laufwerk C: ist fast voll“ nennt nach einer Analyse die größten Posten, vorher verweist er auf den Knopf.
* **Ordner-Baum (Seite „Speicher“):** Jede Zeile ist die Summe der Zeilen darunter (Unterordner plus „übrige Dateien und kleinere Ordner“). Ganz oben steht, was auf dem Laufwerk belegt ist; was ohne Administratorrechte nicht lesbar ist, steht als eigene Zeile. So lässt sich jede Zahl bis zur letzten nachrechnen. Daneben die Ansicht „Größte Posten“ mit Erklärung und Rat je Posten und der Summe der angezeigten Posten in Prozent des belegten Platzes. Der Baum entsteht in `LC.analyzeSpace` (`tree`) aus denselben Messwerten wie die Liste; Test: `tests/leftover.test.js`.

Technik: `POST /api/scan-space` misst (`app/src/LaptopCheck.Scan/Space/`), speichert `space.json` und liefert es; `GET /api/space` gibt die letzte Analyse zurück. Gemessen werden Dateigrößen: Verknüpfungen/Junctions werden nicht verfolgt und Cloud-Platzhalter (nur online) zählen nicht. Die Einordnung steht als lesbare Regelliste in `web/space.js` (`LC.SPACE_RULES`) und lässt sich dort ergänzen. WinSxS wirkt größer, als es wirklich ist (Hardlinks).


## Dateien & Cloud (Google Drive)

* **Erkennung:** *Google Drive für Desktop* erscheint als Laufwerk (meist `G:`, Ordner „Meine Ablage“) oder als Ordner im Benutzerverzeichnis; ebenso OneDrive, Dropbox, Proton Drive, iCloud. Weitere Ordner trägst du unter *Dateien & Cloud → Einstellungen* ein (`data\config.json`). Was erkannt wurde und warum, steht in den Karten.
* **Dein Speicher-Tarif:** In der Karte deines Cloud-Ordners trägst du ihn ein (z. B. **2 TB**). LaptopCheck zeigt dann die sichtbare Belegung und prüft vor jedem Umzug, ob alles hineinpasst.
* **Wichtig:** Im Modus **„Dateien spiegeln“** liegt alles auch lokal – Auslagern spart dann **keinen** Platz. Stelle in den Drive-Einstellungen auf **„Dateien streamen“** um (das Tool weist darauf hin).
* **Alter Spiegel-Ordner („Rest“):** Läuft Drive schon gestreamt (virtuelles Laufwerk, z. B. `G:`) und liegt trotzdem ein Ordner `My Drive` im Benutzerordner, ist das bei **einem** angemeldeten Konto der Rest einer früheren Spiegelung. Er wird nicht mehr synchronisiert (Änderungen erreichen die Cloud nicht, neuere Dateien gibt es nur im Drive). LaptopCheck kennzeichnet ihn als **„alter Rest – nicht mehr synchronisiert“** (`mode: leftover`), scannt ihn nicht, zählt ihn **nicht** als Cloud (sonst würden lokale Kopien fälschlich als „liegt schon in der Cloud“ gelten), bietet ihn nicht als Ziel für Umzüge an und legt die Aufgabe „Alter Google-Drive-Ordner“ an: mit der Größe (aus der Speicher-Analyse) und den Schritten *prüfen → in „… (alt)“ umbenennen → einige Tage beobachten → löschen*. Bei zwei Konten kann einer gespiegelt und einer gestreamt sein; dann bleibt der Ordner „gespiegelt“. Erkennung: `CloudProviders.Detect` (Anzahl der Konto-Ordner unter `%LOCALAPPDATA%GoogleDriveFS`).
* **Umzug in 3 Schritten:** (1) kopieren und jede Datei per SHA-256 prüfen – nichts wird überschrieben, Originale bleiben; (2) du wartest, bis Drive „synchronisiert“ meldet, und schaust im Browser nach; (3) erst dann, mit Häkchen und Eintippen von `ENTFERNEN`, gehen die geprüften Originale in den Papierkorb (und werden vorher noch einmal verglichen).
* **Dein Drive analysieren:** LaptopCheck sieht Drive nur über den Desktop-Client (also die lokale Sicht). Es zeigt lose Dateien im Hauptordner, Namen wie „Unbenannt“/„Kopie von“, zu tiefe Ordner, leere Ordner, Duplikate und eine Ordnungs-Note – plus eine **empfohlene Struktur** (`00 Eingang`, `01 Persönlich`, `02 Finanzen` … `99 Archiv`) und Vorschläge, wohin deine vorhandenen Ordner gehören.
* Der Abgleich „liegt schon in der Cloud“ geschieht über **Name + Größe** (keine Inhalte werden gelesen oder hochgeladen).


## Projekte & GitHub

* **Projekte** legst du von Hand an oder erzeugst sie mit einem Klick aus Repos („Entwürfe“); die typischen Werkzeuge der Programmiersprache werden gleich als Bedarf eingetragen. Pro Projekt: Status, Ziel, Termin, Repository, Ordner, **Ressourcen** (Programm / System / Datei / Hardware / Konto / Wissen – Stand: automatisch, habe ich, brauche ich noch, später, nicht nötig) und Aufgaben. Gespeichert in `data\projects.json`.
* **GitHub:** Mit derselben Anmeldung wie oben (automatisch oder **„Mit GitHub verbinden“**) erscheinen alle deine Repositories, auch private; die Liste wird beim Öffnen des Dashboards alle 12 Stunden von selbst abgeglichen. Gelesen werden nur Name, Sprache, Beschreibung, letzter Push – nie der Code. Die Liste liegt in `data\repos.json` und wird mit lokalen Klonen (aus dem Dateien-Scan) verknüpft.

---

---

## Wie zuverlässig ist „zuletzt benutzt“?

Windows merkt sich, welche Programme über Startmenü, Taskleiste oder Explorer gestartet wurden (Datum, Anzahl, Vordergrundzeit). Das nutzt das Tool.

* **Nicht erfasst:** Programme, die per Kommandozeile, von anderen Programmen oder im Hintergrund starten (z. B. Python, Git, Node, Spiele über Steam). Sie erscheinen als „nicht erkennbar“. **„Unbekannt“ heißt nicht „nie benutzt“** – deshalb entfernt das Tool nie etwas von selbst: Es empfiehlt, und jedes Objekt braucht deine ausdrückliche Bestätigung (siehe *Aufräumen*).
* Aufräum-Tools (CCleaner & Co.) löschen diesen Verlauf manchmal. Ist er leer, sagt das Tool es offen.
* Hintergrund-Updater (z. B. von Adobe) werden bewusst **nicht** als „benutzt“ gezählt.
* Fehlt dir ein Datum, trägst du es im Detail-Fenster selbst ein.

Auch bei „Installiert am“ gilt: Meldet ein Programm kein Datum, wird es aus dem Programmordner geschätzt (mit **≈** markiert).

Die Beschreibungen („Was macht es?“) stammen aus einer eingebauten Liste häufiger Programme (als *automatisch vermutet* gekennzeichnet). Unbekanntes bleibt leer und wartet auf deinen Text.


## Was das Tool nicht kann

* Keine Preise und keine Garantie, dass ein Modul in **dein** Gerät passt: Der Upgrade-Berater nennt Typ, Bauform und Geschwindigkeit und verlinkt die Recherche. Die BIOS-Angaben zu Maximal-RAM und Steckplätzen sind bei Laptops oft ungenau – das Handbuch deines Modells hat das letzte Wort.
* Keine Temperaturen/Lüfter im laufenden Betrieb (dafür HWiNFO oder Core Temp).
* Keine portablen Programme ohne Installer, keine Browser-Erweiterungen, keine Python-/npm-Pakete.
* Der Speicherdruck ist eine **Momentaufnahme**. Am aussagekräftigsten ist ein Scan, während du mit all deinen üblichen Programmen arbeitest.
* Die Support-Fristen für Windows und .NET sind Stand Oktober 2026 eingebaut und gelten für Home/Pro; Enterprise/Education haben andere Fristen.

---

---

## Datenschutz

* Der Dashboard-Server lauscht **nur auf `localhost`** und prüft Host-Header und ein zufälliges Token pro Start (Schutz vor fremden Webseiten).
* Das Dashboard lädt **nichts aus dem Internet** (keine Schriften, keine Skripte).
* Netzwerkzugriff gibt es nur bei der **Update-Prüfung** (`winget upgrade`, Microsoft-Server) – abschaltbar mit `LaptopCheck.exe --no-winget` –, beim **Selbst-Update** (nur `api.github.com`, abschaltbar unter *Einstellungen*), beim **GitHub-Abgleich** (nur mit GitHub-Anmeldung, höchstens alle 12 Stunden, nur `api.github.com`) und wenn du selbst auf einen Recherche-Link klickst.
* Der **Dateien-Scan** liest Namen, Größen und Änderungsdaten deiner Ordner (nicht die Inhalte) und bleibt auf diesem PC. `data\files.json` enthält deshalb Dateinamen – teile sie nicht ungeprüft. Ein GitHub-Token (`data\github-token.txt`) verlässt den PC nur Richtung `api.github.com`.


## Optionen für Fortgeschrittene

```text
LaptopCheck.exe --data-dir <Ordner>   anderen Datenordner verwenden (Standard: %LOCALAPPDATA%\LaptopCheckData\data)
LaptopCheck.exe --port 9000           anderen Port verwenden (0 = beliebig)
LaptopCheck.exe --no-window           nur der lokale Server, gibt LC_URL=... aus (Tests, Demo)
LaptopCheck.exe --scan-only [--out datei.json] [--quick] [--no-winget] [--skip-sizes]
LaptopCheck.exe --scan-files-only [--out datei.json]
```

## Probleme?

* **Die App startet nicht richtig:** Ein Start zählt erst als gelungen, wenn das Dashboard geladen ist. Nach drei misslungenen Starts derselben Version sucht die App sofort nach einer neueren und installiert sie. Details stehen in `data\app-errors.log`.
* **„Keine Verbindung zu LaptopCheck“:** Die App wurde beendet. Starte sie neu (Startmenü) und lade die Seite neu.
* **Einzelne Bereiche leer:** *Einstellungen → Datenlücken* zeigt, welcher Bereich warum nicht lesbar war. „Diagnose kopieren“ liefert die Technik-Infos (ohne Programmliste) zum Weitergeben.
* **Windows warnt vor dem Installer (SmartScreen):** Der Installer ist nicht signiert. *Weitere Informationen → Trotzdem ausführen*.
* **Alles zurücksetzen:** Datenordner `%LOCALAPPDATA%\LaptopCheckData\data` löschen (vorher ggf. `notes.json` sichern). Deinstallieren: Windows-Einstellungen → Apps; die Daten bleiben stehen.
