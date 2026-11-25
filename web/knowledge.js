/* knowledge.js - built-in knowledge about common software.
 *
 * Purpose: answer "what does this program do?" and give a first recommendation
 * for programs the registry says nothing about. It is a heuristic list, shown to
 * the user as "automatisch vermutet" and always overridable.
 *
 * Rule fields:
 *   re     regex tested against the display name (first match wins)
 *   pub    optional regex, must match the publisher too
 *   key    optional regex tested against the registry key name
 *   cat    category label
 *   kind   app | vendor | security | game | runtime | driver | system
 *          (runtime/driver/system = "components": no usage tracking, hidden by default)
 *   desc   what it does (German)
 *   advice optional free-text recommendation
 *   flags  keep | eol | pup | bloat | av | dotnet | java | python-part | updater | telemetry
 *   exes   executable names that prove the program was used (array, or {namePattern: [exes]} for grouped rules)
 *   flags  also: notrace = use is invisible to Windows (command line, started by a launcher)
 *          bg = works in the background (cloud sync, backup, device drivers): launch history says nothing about use,
 *               so it is never judged "rarely used", and its autostart entry is its purpose
 */
(function (root) {
  'use strict';
  const LC = (root.LC = root.LC || {});

  const C = {
    BROWSER: 'Browser',
    OFFICE: 'Büro & Produktivität',
    COMM: 'Kommunikation',
    DEV: 'Entwicklung',
    MEDIA: 'Medien & Kreativ',
    GAMES: 'Spiele',
    SEC: 'Sicherheit & Datenschutz',
    CLOUD: 'Cloud & Synchronisation',
    UTIL: 'Hilfsprogramme',
    SYSTEM: 'Windows & System',
    DRIVER: 'Treiber & Firmware',
    RUNTIME: 'Laufzeiten & Bibliotheken',
    VENDOR: 'Hersteller-Software',
    STORE: 'Windows-Apps',
    REMOTE: 'Fernzugriff & VPN',
    PRINT: 'Drucker & Scanner',
    OTHER: 'Sonstiges',
  };
  LC.CATEGORIES = Object.values(C);
  LC.COMPONENT_KINDS = ['runtime', 'driver', 'system'];

  const R = [];
  const add = (re, cat, kind, desc, o) => R.push(Object.assign({ re, cat, kind, desc }, o || {}));

  const PUP_ADVICE = 'Gilt als potenziell unerwünscht (Werbung, Telemetrie oder Scareware). Deinstallieren empfohlen.';
  const VENDOR_ADVICE = 'Vom Hersteller vorinstalliert. Nützlich für Treiber-/BIOS-Updates; den Autostart kannst du meist abschalten.';

  /* ---------- components that must not be removed ---------- */
  add(/Visual C\+\+.*(Redistributable|Runtime|Minimum|Additional)|Microsoft Visual C\+\+ \d{4}/i, C.RUNTIME, 'runtime',
    'C++-Laufzeitbibliothek, die viele Programme und Spiele zum Starten brauchen. Mehrere Jahrgänge sowie x86 und x64 nebeneinander sind normal.',
    { flags: ['keep'], advice: 'Nicht entfernen – sonst starten Programme/Spiele nicht mehr.' });
  add(/WebView2/i, C.RUNTIME, 'runtime',
    'Eingebettete Edge-Engine, die viele Programme (Office, Teams, Widgets, Installer) für ihre Oberfläche nutzen.',
    { flags: ['keep'], advice: 'Nicht entfernen.' });
  add(/Microsoft \.NET Framework|\.NET Framework \d/i, C.RUNTIME, 'runtime',
    'Klassische .NET-Laufzeit; Teil von Windows bzw. Voraussetzung für ältere Programme.', { flags: ['keep'] });
  add(/\.NET.*(SDK|Toolset)/i, C.DEV, 'runtime',
    '.NET-Entwicklungskit (Compiler und Werkzeuge) – nur für Programmierer nötig.', { flags: ['dotnet'] });
  add(/(Microsoft )?(\.NET|ASP\.NET Core|Windows Desktop Runtime|\.NET Host|\.NET AppHost|\.NET Targeting)/i, C.RUNTIME, 'runtime',
    '.NET-Laufzeit; Programme, die mit modernem .NET gebaut sind, brauchen die passende Version.', { flags: ['dotnet'] });
  add(/^Python \d+\.\d+(\.\d+)? (Core Interpreter|Documentation|Development Libraries|Executables|pip Bootstrap|Standard Library|Tcl\/Tk Support|Test Suite|Add to Path|Utility Scripts)/i,
    C.RUNTIME, 'runtime', 'Teilkomponente einer Python-Installation (wird zusammen mit Python entfernt).', { flags: ['python-part'] });
  add(/^Python Launcher/i, C.DEV, 'runtime', 'Startet die passende Python-Version (Befehl "py").', {});
  add(/^Python \d/i, C.DEV, 'app', 'Programmiersprache Python samt Interpreter; Grundlage für Skripte und viele Entwickler-/Datenanalyse-Tools (Kommandozeile).', { flags: ['notrace'], exes: ['python.exe', 'pythonw.exe', 'py.exe'] });
  add(/^(Java\(TM\)|Java \d|Java SE|Java Runtime|Java Development Kit|Oracle JDK|JDK \d|JRE \d|Eclipse Temurin|Eclipse Adoptium|Amazon Corretto|Microsoft Build of OpenJDK|OpenJDK|AdoptOpenJDK|Azul Zulu|BellSoft Liberica)/i,
    C.RUNTIME, 'runtime', 'Java-Laufzeit bzw. -Entwicklungskit. Wird von Java-Programmen (z. B. Minecraft, IDEs, Unternehmenssoftware) benötigt.', { flags: ['java'] });
  add(/Windows (Software Development Kit|SDK)|Windows Kits|Windows Driver Kit|WinAppDeploy|Universal CRT (Extension|Tools)/i, C.DEV, 'runtime',
    'Entwicklungskit für Windows-Programme (Header, Bibliotheken, Debugger). Oft mehrere GB groß.',
    { advice: 'Nur nötig, wenn du Windows-Software selbst kompilierst. Ältere SDK-Versionen kannst du entfernen.' });
  add(/Microsoft (Visual Studio|VS) .*(Runtime|Redistributable|Tools for Applications|Tools for Office|Remote Debugger|Setup Bootstrapper|Standalone)|Microsoft Visual Studio Installer|Visual Studio (Community|Professional|Enterprise|Build Tools|Installer).*(Component|Extension)/i,
    C.DEV, 'runtime', 'Hilfskomponente von Visual Studio bzw. von Programmen, die damit gebaut wurden.', {});
  add(/^(Microsoft )?Visual Studio (Community|Professional|Enterprise|Build Tools|Code Insiders)|^Microsoft Visual Studio \d/i, C.DEV, 'app',
    'Entwicklungsumgebung (IDE) für C#, C++ und mehr. Belegt oft 10–50 GB.', { exes: ['devenv.exe'] });
  add(/Visual Studio Code/i, C.DEV, 'app', 'Beliebter Code-Editor mit Erweiterungen (Microsoft).', { exes: ['code.exe'] });
  add(/SQL Server.*(Management Studio|SSMS)/i, C.DEV, 'app', 'Verwaltungsoberfläche für Microsoft-SQL-Datenbanken.', { exes: ['ssms.exe'] });
  add(/SQL Server|SQLEXPRESS|LocalDB|OLE DB Driver|ODBC Driver for SQL/i, C.DEV, 'runtime', 'Microsoft-SQL-Server bzw. dessen Treiber/Komponenten (Datenbank).', {});

  /* ---------- Microsoft / Windows ---------- */
  add(/Click-to-Run|Office .*(Licensing|Development|Proofing|Language Pack|Shared)|Microsoft Office .* (MUI|Proofing)|Microsoft Update Health Tools|Microsoft Office Add-in/i, C.SYSTEM, 'system',
    'Hilfskomponente von Microsoft Office bzw. Windows Update.', { flags: ['keep'] });
  add(/^Microsoft Teams classic|Teams Machine-Wide Installer/i, C.COMM, 'app',
    'Altes Teams ("classic") bzw. dessen Installer, der Teams für jeden neuen Benutzer nachinstalliert.',
    { flags: ['eol'], advice: 'Das klassische Teams wird nicht mehr unterstützt. Entfernen, wenn du das neue Teams nutzt.', exes: ['teams.exe'] });
  add(/^Microsoft Teams/i, C.COMM, 'app', 'Chat, Videokonferenzen und Zusammenarbeit (Microsoft Teams).', { exes: ['ms-teams.exe', 'teams.exe'] });
  add(/^(Microsoft 365|Microsoft Office|Office 16)/i, C.OFFICE, 'app', 'Office-Paket (Word, Excel, PowerPoint, Outlook …).',
    { exes: ['winword.exe', 'excel.exe', 'powerpnt.exe', 'outlook.exe', 'onenote.exe', 'msaccess.exe', 'mspub.exe'] });
  add(/^Microsoft (OneNote|Outlook|Word|Excel|PowerPoint|Access|Publisher|Project|Visio)/i, C.OFFICE, 'app', 'Einzelne Office-Anwendung.', { exes: ['winword.exe', 'excel.exe', 'powerpnt.exe', 'outlook.exe', 'onenote.exe', 'msaccess.exe', 'mspub.exe', 'visio.exe', 'winproj.exe'] });
  add(/^Microsoft OneDrive/i, C.CLOUD, 'app', 'Cloud-Speicher von Microsoft; synchronisiert Ordner (Desktop, Dokumente, Bilder) mit der Cloud.', { exes: ['onedrive.exe'], advice: 'Nützlich als Backup; wenn du ihn nicht nutzt, in OneDrive die Synchronisierung beenden und Autostart deaktivieren.' });
  add(/^Microsoft Edge Update|Microsoft Edge Elevation/i, C.SYSTEM, 'system', 'Aktualisiert Microsoft Edge im Hintergrund.', { flags: ['keep'] });
  add(/^Microsoft Edge$/i, C.BROWSER, 'app', 'Standard-Browser von Windows (Chromium-basiert). Fest ins System integriert.', { exes: ['msedge.exe'], flags: ['keep'] });
  add(/Windows PC Health Check|Microsoft Update Health|Windows Subsystem for (Linux|Android)|Windows Setup Remediations|Microsoft Policy Platform|Application Error Reporting|Windows Driver Package|Windows Resource Kit|Microsoft Windows Desktop Runtime|Update for Windows/i,
    C.SYSTEM, 'system', 'Windows-Systemkomponente bzw. Treiberpaket.', { flags: ['keep'] });
  add(/Microsoft (Silverlight)/i, C.RUNTIME, 'runtime', 'Silverlight – abgekündigte Browser-Technik (Support beendet 2021).', { flags: ['eol'], advice: 'Entfernen – wird nirgends mehr benötigt.' });
  add(/Adobe (Flash|Shockwave)/i, C.RUNTIME, 'runtime', 'Flash/Shockwave-Player – abgekündigt (Support endete 2020), bekanntes Sicherheitsrisiko.', { flags: ['eol'], advice: 'Sofort entfernen.' });
  add(/QuickTime/i, C.MEDIA, 'app', 'Apples alter QuickTime-Player für Windows – wird seit 2016 nicht mehr aktualisiert, bekannte Sicherheitslücken.', { flags: ['eol'], advice: 'Entfernen.' });
  add(/Skype for Business|Lync/i, C.COMM, 'app', 'Altes Firmen-Chatprogramm von Microsoft (Nachfolger: Teams).', { flags: ['eol'], advice: 'Entfernen, wenn du Teams nutzt.' });
  add(/^Skype$|^Skype for Desktop/i, C.COMM, 'app', 'Skype (Telefonie/Video). Microsoft hat Skype im Mai 2025 eingestellt.', { flags: ['eol'], advice: 'Entfernen – Skype wurde von Microsoft eingestellt.' });

  /* ---------- browsers ---------- */
  add(/Google Chrome/i, C.BROWSER, 'app', 'Webbrowser von Google.', { exes: ['chrome.exe'] });
  add(/Mozilla Maintenance Service/i, C.SYSTEM, 'system', 'Hilfsdienst, der Firefox ohne Admin-Abfrage aktualisiert.', { flags: ['keep'] });
  add(/Mozilla Firefox/i, C.BROWSER, 'app', 'Webbrowser von Mozilla.', { exes: ['firefox.exe'] });
  add(/^Brave$|Brave Browser/i, C.BROWSER, 'app', 'Datenschutzorientierter Chromium-Browser mit Werbeblocker.', { exes: ['brave.exe'] });
  add(/^Opera( GX| Stable)?\b/i, C.BROWSER, 'app', 'Webbrowser (Opera / Opera GX für Gamer).', { exes: ['opera.exe'] });
  add(/^Vivaldi/i, C.BROWSER, 'app', 'Konfigurierbarer Chromium-Browser.', { exes: ['vivaldi.exe'] });
  add(/Tor Browser/i, C.BROWSER, 'app', 'Browser für anonymes Surfen über das Tor-Netzwerk.', { exes: ['firefox.exe'] });

  /* ---------- security ---------- */
  add(/McAfee WebAdvisor|McAfee Security Scan|McAfee Safe Connect|McAfee Application Installer|McAfee Total Protection Trial|McAfee .*Trial/i, C.SEC, 'security',
    'Vorinstallierte McAfee-Zusatzsoftware/Testversion; läuft oft im Hintergrund und wirbt für Abos.', { flags: ['pup', 'av'], advice: PUP_ADVICE + ' Windows Defender schützt bereits.' });
  add(/McAfee|Norton|Avast|AVG\b|Kaspersky|Bitdefender|ESET|Avira|Trend Micro|F-Secure|Panda|Sophos|Webroot|Malwarebytes|G DATA|Comodo/i, C.SEC, 'security',
    'Virenschutz / Sicherheitssoftware eines Drittanbieters.', { flags: ['av'], advice: 'Immer nur ein Virenscanner mit Echtzeitschutz – zwei gleichzeitig bremsen und stören sich. Ohne gültiges Abo ist Windows Defender die bessere Wahl.' });
  add(/CCleaner|Advanced SystemCare|IObit|Driver Booster|DriverPack|Driver Easy|Driver Updater|DriverUpdate|Reimage|PC Optimizer|MyCleanPC|Wise (Registry|Care)|Registry (Cleaner|Booster|Mechanic)|Restoro|Slimware|SlimCleaner|Auslogics|Glary|Uniblue|SpeedUpMyPC|PC Cleaner|Smart Defrag/i,
    C.UTIL, 'app', '"Tuning"- bzw. Treiber-Updater-Programm. Bringt auf modernen Windows-Versionen kaum Nutzen und kann Schaden anrichten.',
    { flags: ['pup', 'updater'], advice: PUP_ADVICE + ' Treiber besser über Windows Update bzw. den Hersteller beziehen.' });
  add(/Babylon|Conduit|Ask Toolbar|Search Protect|Yahoo! Toolbar|MyWebSearch|WebCompanion|Wajam|Delta Search|SweetIM|Browser Protect|PUP\./i, C.OTHER, 'app',
    'Toolbar/Suchmaschinen-Kaperer – verändert Browser-Einstellungen.', { flags: ['pup'], advice: 'Sofort deinstallieren.' });
  add(/1Password|Bitwarden|KeePass|LastPass|Dashlane|Enpass|Proton Pass/i, C.SEC, 'app', 'Passwort-Manager.', { exes: { '1password': ['1password.exe'], bitwarden: ['bitwarden.exe'], keepassxc: ['keepassxc.exe'], 'keepass(?!xc)': ['keepass.exe'], lastpass: ['lastpass.exe'] } });
  add(/NordVPN|ExpressVPN|ProtonVPN|Proton VPN|Mullvad|Surfshark|CyberGhost|Windscribe|Private Internet Access|OpenVPN|WireGuard|TunnelBear|Hotspot Shield/i, C.REMOTE, 'app', 'VPN-Client (verschlüsselte Verbindung / Netzwerktunnel).', {});
  add(/Cisco (AnyConnect|Secure Client)|GlobalProtect|FortiClient|Pulse Secure|Check Point|SonicWall|Zscaler|Tailscale|ZeroTier|Hamachi/i, C.REMOTE, 'app', 'VPN-/Netzwerk-Client, meist für Firmen-Zugänge.', {});
  add(/TeamViewer|AnyDesk|Parsec|RustDesk|UltraViewer|Chrome Remote Desktop|Splashtop|RealVNC|TightVNC|UltraVNC|Remote Desktop Manager|mRemoteNG|RDCMan/i, C.REMOTE, 'app', 'Fernwartung / Remote-Desktop.',
    { advice: 'Nur installiert lassen, wenn du es regelmäßig brauchst – Fernwartungssoftware ist ein beliebtes Angriffsziel.' });

  /* ---------- cloud ---------- */
  add(/Dropbox|Google Drive|Proton Drive|Drive File Stream|iCloud|MEGAsync|MEGA\b|Nextcloud|ownCloud|pCloud|Sync\.com|Tresorit|Box Drive|Syncthing|Resilio/i, C.CLOUD, 'app', 'Cloud-Speicher mit Ordner-Synchronisation.', { exes: { dropbox: ['dropbox.exe'], 'google drive|drive file stream': ['googledrivefs.exe'], icloud: ['icloud.exe'], nextcloud: ['nextcloud.exe'], mega: ['megasync.exe'], proton: ['protondrive.exe'] }, flags: ['bg'],
    advice: 'Synchronisiert im Hintergrund – Windows sieht dabei keine „Starts“. Wer den Cloud-Ordner nutzt, braucht den Autostart.' });
  add(/Backblaze|Acronis|Veeam|Macrium|Duplicati|Cobian|SyncBack|Syncthing|FreeFileSync/i, C.UTIL, 'app', 'Datensicherung/Synchronisation, die im Hintergrund läuft.', { flags: ['bg'], advice: 'Läuft planmäßig im Hintergrund – Windows sieht dabei keine „Starts“.' });
  add(/GAOMON|Wacom|Huion|XP-?Pen|VEIKK|UGEE|Pen Tablet|Tablet Driver/i, C.VENDOR, 'vendor', 'Treiber und Einstellungsprogramm eines Zeichentabletts (Stiftdruck, Tasten).', { flags: ['bg'], advice: 'Nötig, solange du das Zeichentablett benutzt (ohne Treiber nur Mausfunktion, kein Stiftdruck). Läuft im Hintergrund; Windows sieht dabei keine „Starts“.' });

  /* ---------- communication ---------- */
  add(/^Zoom|Zoom Workplace/i, C.COMM, 'app', 'Videokonferenzen.', { exes: ['zoom.exe'] });
  add(/^Slack\b/i, C.COMM, 'app', 'Team-Chat für Firmen.', { exes: ['slack.exe'] });
  add(/^Discord\b/i, C.COMM, 'app', 'Chat/Sprachchat, v. a. für Gaming-Communities.', { exes: ['discord.exe'] });
  add(/WhatsApp|Telegram|Signal\b|Viber|Threema|Element\b/i, C.COMM, 'app', 'Messenger.', { exes: { whatsapp: ['whatsapp.exe'], telegram: ['telegram.exe'], signal: ['signal.exe'], viber: ['viber.exe'] } });
  add(/Webex|GoToMeeting|BlueJeans|Cisco Jabber|RingCentral|Google Meet|Skype Meetings/i, C.COMM, 'app', 'Video-/Telefonkonferenz-Software.', {});
  add(/Thunderbird|eM Client|Mailbird|Postbox/i, C.COMM, 'app', 'E-Mail-Programm.', { exes: { thunderbird: ['thunderbird.exe'], 'em client': ['emclient.exe'] } });

  /* ---------- media & creative ---------- */
  add(/VLC media player|^VLC\b/i, C.MEDIA, 'app', 'Universeller Medienplayer für fast alle Video-/Audioformate.', { exes: ['vlc.exe'] });
  add(/Spotify/i, C.MEDIA, 'app', 'Musik-Streaming.', { exes: ['spotify.exe'] });
  add(/^iTunes/i, C.MEDIA, 'app', 'Apple-Musikverwaltung und iPhone-Sicherung unter Windows.', { exes: ['itunes.exe'] });
  add(/Apple (Application Support|Mobile Device Support|Software Update)|^Bonjour/i, C.SYSTEM, 'system', 'Hilfskomponente von iTunes/iCloud (Gerätekommunikation, Netzwerk-Erkennung).', { advice: 'Wird mit iTunes/iCloud mitgezogen; nur entfernen, wenn beide weg sind.' });
  add(/K-Lite|Codec Pack|MPC-HC|Media Player Classic|PotPlayer|foobar2000|MediaMonkey|AIMP|Winamp|GOM (Player|Cam)/i, C.MEDIA, 'app', 'Medienplayer bzw. Codec-Sammlung.', {});
  add(/OBS Studio/i, C.MEDIA, 'app', 'Bildschirmaufnahme und Live-Streaming.', { exes: ['obs64.exe', 'obs32.exe'] });
  add(/Audacity|HandBrake|FFmpeg|MKVToolNix|ShareX|Greenshot|Snagit|Camtasia|Bandicam|Fraps|ScreenToGif|LICEcap/i, C.MEDIA, 'app', 'Audio-/Video-Werkzeug oder Bildschirmaufnahme.', {});
  add(/GIMP|Inkscape|Krita|Paint\.NET|IrfanView|XnView|FastStone|Blender|darktable|RawTherapee|Affinity|Figma|Canva|Lightroom|Photoshop|Illustrator|Premiere|After Effects|InDesign|DaVinci Resolve|Corel|PaintTool|MediBang/i, C.MEDIA, 'app', 'Bild-/Grafik-/Videobearbeitung.', {});
  add(/Adobe (Creative Cloud|Genuine|Desktop Service|Content Synchronizer|Acrobat Distiller|Refresh Manager)|Adobe Application Manager|Adobe Update/i, C.MEDIA, 'app',
    'Verwaltung/Updater der Adobe-Programme; läuft meist im Hintergrund.', { flags: ['bloat'], advice: 'Nur nötig, solange du Adobe-Programme nutzt. Autostart darf aus.' });
  add(/Adobe (Acrobat|Reader)/i, C.OFFICE, 'app', 'PDF-Betrachter und -Bearbeitung von Adobe.', { exes: ['acrobat.exe', 'acrord32.exe', 'acrord64.exe'] });
  add(/Adobe/i, C.MEDIA, 'app', 'Adobe-Programm.', {});
  add(/Foxit|Sumatra ?PDF|PDF-XChange|PDFsam|Nitro|PDF24|Master PDF|Okular/i, C.OFFICE, 'app', 'PDF-Betrachter bzw. -Werkzeug.', {});
  add(/LibreOffice|OpenOffice|WPS Office|OnlyOffice|FreeOffice|Notion|Obsidian|Evernote|Joplin|Simplenote|Typora/i, C.OFFICE, 'app', 'Office-Paket bzw. Notiz-/Wissensverwaltung.', {});
  add(/Calibre|Kindle|Kobo|Thorium Reader|Sigil/i, C.OFFICE, 'app', 'E-Book-Verwaltung/Reader.', {});

  /* ---------- development ---------- */
  add(/GitHub Desktop|TortoiseGit|TortoiseSVN|SourceTree|GitKraken|Fork\b/i, C.DEV, 'app', 'Grafische Oberfläche für Git/SVN.', { exes: { 'github desktop': ['githubdesktop.exe'], gitkraken: ['gitkraken.exe'], sourcetree: ['sourcetree.exe'] } });
  add(/^Git\b|Git for Windows|Git Credential Manager/i, C.DEV, 'app', 'Versionsverwaltung Git (Kommandozeile und Git-Bash).', { flags: ['notrace'], exes: ['git-bash.exe', 'git-cmd.exe'] });
  add(/Node\.js|npm\b|Yarn|pnpm|Deno|Bun\b/i, C.DEV, 'app', 'JavaScript-Laufzeit und Paketverwaltung für Webentwicklung/Tools (Kommandozeile).', { flags: ['notrace'], exes: ['node.exe'] });
  add(/rustup|Rust\b|Go Programming|Golang|Ruby|Perl|Strawberry|Lua\b|CMake|MSYS2|MinGW|Cygwin|Anaconda|Miniconda|Conda\b|OpenSSL|Vagrant|kubectl|Terraform|AWS Command Line|AWS CLI|Azure CLI|Google Cloud SDK|GitHub CLI|OpenSSH|Chocolatey|Scoop|Windows Package Manager/i,
    C.DEV, 'app', 'Entwickler-Werkzeug für die Kommandozeile (Compiler, Interpreter, Paketverwaltung, Cloud-CLI).', { flags: ['notrace'] });
  add(/Docker Desktop|Docker\b|Rancher Desktop|Podman/i, C.DEV, 'app', 'Container-Plattform für Entwicklungs-/Serverumgebungen. Belegt viel RAM und Speicher.', { exes: ['docker desktop.exe', 'docker.exe'] });
  add(/Android Studio|IntelliJ|PyCharm|WebStorm|CLion|Rider|GoLand|PhpStorm|DataGrip|JetBrains|Eclipse|NetBeans|Sublime|Notepad\+\+|Atom\b|Vim\b|Neovim|Emacs|Cursor\b|Zed\b|Postman|Insomnia|DBeaver|HeidiSQL|MySQL|PostgreSQL|MongoDB|Redis|pgAdmin|WinMerge|Beyond Compare|Meld|Wireshark|Npcap|Fiddler|Charles|VirtualBox|VMware|R for Windows|RStudio|MATLAB|Arduino|PlatformIO|KiCad|Unity Hub|Unity\b|Unreal|Godot/i,
    C.DEV, 'app', 'Entwicklungs-/IT-Werkzeug (Editor, IDE, Datenbank, Netzwerkanalyse, Virtualisierung …).', {});
  add(/PuTTY|WinSCP|FileZilla|MobaXterm|Termius|Windows Terminal|Cmder|ConEmu|Royal TS/i, C.DEV, 'app', 'Terminal / SSH / Dateiübertragung.', {});

  /* ---------- games ---------- */
  add(/^Steam$/i, C.GAMES, 'game', 'Spieleplattform und -Store von Valve. Hier werden Spiele gekauft, installiert und aktualisiert.', { exes: ['steam.exe'] });
  add(/Epic Games Launcher/i, C.GAMES, 'game', 'Spieleplattform und -Store von Epic Games.', { exes: ['epicgameslauncher.exe'] });
  add(/GOG GALAXY/i, C.GAMES, 'game', 'Spieleplattform von GOG (DRM-frei).', { exes: ['galaxyclient.exe'] });
  add(/^EA app|^EA Desktop|^Origin$|Electronic Arts/i, C.GAMES, 'game', 'Spieleplattform von Electronic Arts.', { exes: ['eadesktop.exe', 'origin.exe'] });
  add(/Ubisoft Connect|Uplay/i, C.GAMES, 'game', 'Spieleplattform von Ubisoft.', { exes: ['ubisoftconnect.exe', 'upc.exe'] });
  add(/Battle\.net/i, C.GAMES, 'game', 'Spieleplattform von Blizzard.', { exes: ['battle.net.exe'] });
  add(/Riot (Vanguard|Client)|League of Legends|VALORANT/i, C.GAMES, 'game', 'Riot-Games-Software bzw. Spiel; Vanguard ist ein Anti-Cheat mit Systemtreiber.', {});
  add(/Easy Anti-Cheat|BattlEye|EAC\b/i, C.GAMES, 'system', 'Anti-Cheat-Komponente für Online-Spiele.', {});
  add(/Xbox|Gaming Services|Minecraft|Rockstar|Bethesda|Ubisoft|GOG\.com|Roblox|Wargaming|Lutris/i, C.GAMES, 'game', 'Spiel bzw. Spiele-Komponente.', {});
  add(/./i, C.GAMES, 'game', 'Über Steam installiertes Spiel.', { key: /^Steam App \d+/i, flags: ['notrace', 'launcher-game'], advice: 'Windows sieht den Start über Steam nicht. „Zuletzt gespielt“ steht in der Steam-Bibliothek.' });

  /* ---------- hardware vendors & drivers ---------- */
  add(/NVIDIA (Graphics Driver|Grafiktreiber)|NVIDIA GeForce|NVIDIA PhysX|NVIDIA HD Audio|NVIDIA FrameView|NVIDIA USB|NVIDIA Install|NVIDIA Update|NVIDIA Container|NVIDIA Broadcast Driver/i, C.DRIVER, 'driver',
    'NVIDIA-Treiberpaket bzw. -Komponente für die Grafikkarte.', { flags: ['keep'], advice: 'Treiber gelegentlich aktualisieren; die Zusatzkomponenten (PhysX, HD Audio) gehören dazu.' });
  add(/GeForce Experience|NVIDIA App\b|NVIDIA Control Panel|NVIDIA Broadcast|NVIDIA Ansel|ShadowPlay/i, C.VENDOR, 'vendor',
    'NVIDIA-Zusatzsoftware: Treiber-Updates, Spiele-Optimierung, Aufnahme. Treiber lassen sich auch ohne diese Programme installieren.', { flags: ['bloat'], advice: 'Optional. Autostart abschalten, wenn du die Overlay-/Aufnahmefunktionen nicht brauchst.' });
  add(/AMD (Software|Radeon|Chipset|Ryzen|Adrenalin|Catalyst|PSP|SMBus|I2C|GPIO|USB|PCI)|Radeon/i, C.DRIVER, 'driver', 'AMD-Treiber/-Software für Grafik und Chipsatz.', { flags: ['keep'] });
  add(/Intel\(R\) (Driver & Support Assistant|Driver and Support Assistant)/i, C.VENDOR, 'vendor', 'Prüft, ob es neue Intel-Treiber gibt.', { advice: 'Praktisch zum Aktualisieren; nicht dauerhaft nötig.' });
  add(/Intel\(R\) (Computing Improvement|Software Improvement)/i, C.VENDOR, 'vendor', 'Sendet anonymisierte Nutzungsdaten an Intel.', { flags: ['telemetry'], advice: 'Kann entfernt werden.' });
  add(/Intel\(R\)? |Intel (Graphics|Wireless|Bluetooth|Management|Rapid Storage|Chipset|Serial|Smart Sound|Optane|Thunderbolt|PROSet|Dynamic|Unison|Arc)/i, C.DRIVER, 'driver', 'Intel-Treiber bzw. -Systemkomponente (Grafik, WLAN, Bluetooth, Chipsatz, Management Engine …).', { flags: ['keep'] });
  add(/Realtek|Waves MaxxAudio|Nahimic|Dolby (Audio|Access|Digital)|DTS (Sound|Audio)|Sound Blaster|Conexant|IDT Audio|Cirrus Logic/i, C.DRIVER, 'driver', 'Audio-/Soundtreiber bzw. Klang-Verbesserung.', { flags: ['keep'] });
  add(/Synaptics|ELAN|Alps Pointing|Touchpad|Fingerprint|Goodix|Validity|Qualcomm|Atheros|MediaTek|Broadcom|Killer (Control|Network)|Bluetooth Driver|Wireless LAN Driver|Chipset Driver|Card Reader|SD Host|Camera Driver|Webcam Driver|Thunderbolt/i, C.DRIVER, 'driver', 'Gerätetreiber (Touchpad, Fingerabdruck, WLAN, Bluetooth, Kamera …).', { flags: ['keep'] });
  add(/Lenovo (Vantage|Commercial Vantage|System Update|Welcome|Hotkeys|Utility|Service Bridge|Smart Care|Migration|Now|Quick Clean)|ThinkPad|Lenovo/i, C.VENDOR, 'vendor', 'Lenovo-Zentrale für Treiber-/BIOS-Updates, Garantie und Geräteeinstellungen.', { flags: ['bloat'], advice: VENDOR_ADVICE });
  add(/HP (Support Assistant|Smart|Wolf|Documentation|System Event|Sure|Connection Optimizer|Device Hub|Notifications|Easy Clean|Privacy)|HP\b.*(Print|Scan)|Hewlett/i, C.VENDOR, 'vendor', 'HP-Hilfsprogramme (Support, Druckerverwaltung, Sicherheit).', { flags: ['bloat'], advice: VENDOR_ADVICE });
  add(/Dell (SupportAssist|Command|Optimizer|Digital Delivery|Update|Power Manager|Display Manager|Peripheral|Customer Connect|Foundation)|Alienware/i, C.VENDOR, 'vendor', 'Dell-Hilfsprogramme für Treiber-/BIOS-Updates, Diagnose und Gerätesteuerung.', { flags: ['bloat'], advice: VENDOR_ADVICE });
  add(/MyASUS|Armoury Crate|ASUS |ROG |Aura Sync|Acer (Care|Quick|Portal|Collection|Jewel)|MSI (Center|Dragon|Afterburner|Companion)|Dragon Center|Samsung (Settings|Update|Magician|Notes|Recovery)|Gigabyte|Predator|Nitro ?Sense|Razer|Corsair|iCUE|SteelSeries|Logitech|Logi |G HUB|Elgato|Wacom|HyperX|Turtle Beach|Cooler Master|NZXT|Thermaltake/i,
    C.VENDOR, 'vendor', 'Hersteller-Software für Laptop-/Zubehör-Steuerung (Beleuchtung, Lüfter, Tasten, Updates).', { flags: ['bloat'], advice: 'Nur behalten, wenn du die Funktionen (Beleuchtung, Profile, Updates) nutzt.' });
  add(/HWiNFO|CPU-Z|GPU-Z|CrystalDiskInfo|CrystalDiskMark|Speccy|OCCT|AIDA64|Core Temp|HWMonitor|MSI Afterburner|RivaTuner|Prime95|Cinebench|3DMark|FurMark|MemTest|TreeSize|WinDirStat|WizTree|SpaceSniffer|Everything\b|BleachBit|Sysinternals|Process (Explorer|Hacker|Monitor)|System Informer|Autoruns|HDDScan|Hard Disk Sentinel/i,
    C.UTIL, 'app', 'Diagnose-, Benchmark- bzw. Aufräum-Werkzeug (Hardware-Info, Temperaturen, Speicherplatz …).', {});
  add(/Canon|Epson|Brother|Xerox|Ricoh|Kyocera|Lexmark|Samsung Printer|Konica|OKI\b|Printer|Drucker|Scanner|ScanSnap|NAPS2/i, C.PRINT, 'driver', 'Treiber/Software für Drucker oder Scanner.', { advice: 'Nur nötig, solange das Gerät im Einsatz ist; Treiber alter Drucker kannst du entfernen.' });

  /* ---------- utilities ---------- */
  add(/7-Zip|WinRAR|PeaZip|Bandizip|WinZip|NanaZip/i, C.UTIL, 'app', 'Packprogramm für ZIP/RAR/7z-Archive.',
    { exes: { '7-zip': ['7zfm.exe', '7zg.exe'], winrar: ['winrar.exe'], peazip: ['peazip.exe'], bandizip: ['bandizip.exe'], winzip: ['winzip64.exe'] } });
  add(/PowerToys|AutoHotkey|Ditto|f\.lux|Flameshot|Lightshot|Rufus|balenaEtcher|Ventoy|Revo Uninstaller|Bulk Crap|BCUninstaller|Listary|Wox|Flow Launcher|Sticky|StartAllBack|Start11|Rainmeter|Stardock|Fences|TranslucentTB|DisplayFusion|Dexpot|Ninite/i,
    C.UTIL, 'app', 'Komfort-/Systemhilfsprogramm (Tastenkürzel, Launcher, USB-Stick-Erstellung, Fensterverwaltung …).', {});
  add(/Wireshark|Npcap|WinPcap|Nmap|Advanced IP Scanner|Angry IP/i, C.DEV, 'app', 'Netzwerkanalyse (Pakete mitschneiden, Netz scannen).', {});

  /* ---------- Microsoft Store apps (matched by display name) ---------- */
  const ms = { pub: /Microsoft|Windows/i };
  add(/Xbox|Gaming App|Game Bar|Solitaire|Mahjong|Minesweeper|Candy Crush|Bubble Witch|March of Empires|Farm ?Heroes|Disney|TikTok|Netflix|Prime Video|Hulu|Instagram|Facebook|Messenger|LinkedIn|Twitter|Pinterest|Spotify|Roblox|Hidden City|Royal Revolt|Asphalt|Fitbit|Duolingo|Amazon/i,
    C.STORE, 'app', 'Aus dem Microsoft Store vorinstallierte oder nachgeladene Unterhaltungs-/Social-App.', { flags: ['bloat'], advice: 'Wenn du sie nicht nutzt: Rechtsklick im Startmenü → Deinstallieren.' });
  add(/Clipchamp|To Do|Mail and Calendar|Outlook \(new\)|Photos|Fotos|Camera|Kamera|Calculator|Rechner|Notepad|Editor|Paint|Snipping|Ausschneiden|Sticky Notes|Voice Recorder|Sprachrekorder|Maps|Karten|Whiteboard|Power Automate|Dev Home|Copilot|Quick Assist|Windows Terminal|Media Player|Movies|Filme|Groove|Alarms|Wecker|Clock|Weather|Wetter|News|Nachrichten|Tips|Get Help|Hilfe|Feedback|Phone Link|Link zum Smartphone|Your Phone|Cortana|People|Journal|3D Viewer|Paint 3D|Mixed Reality|Office|Microsoft 365|Store|Widgets|Terminal/i,
    C.STORE, 'app', 'Mitgelieferte Windows-App von Microsoft.', Object.assign({ advice: 'Gehört zum Windows-Lieferumfang; nur entfernen, wenn du sie sicher nicht brauchst (Einstellungen → Apps).' }, ms));
  add(/Extension|Erweiterung|Codec|HEIF|HEVC|VP9|AV1|WebP|Raw Image|Webmedia|Dolby/i, C.STORE, 'system', 'Hintergrund-Erweiterung (Codec/Bildformat) aus dem Microsoft Store.', { flags: ['keep'] });

  // registry-key rules (Steam games) take precedence; Array#sort is stable, the rest keeps its order
  R.sort((a, b) => (b.key ? 1 : 0) - (a.key ? 1 : 0));
  LC.KB_RULES = R;

  /**
   * Find the first matching rule for an app. Returns a plain object or a default.
   * @param {{name:string, publisher?:string, regKey?:string, source?:string, hasStartEntry?:boolean}} app
   */
  LC.kbLookup = (app) => {
    const name = app.name || '';
    const pub = app.publisher || '';
    for (const r of R) {
      if (r.key) {
        if (!app.regKey || !r.key.test(app.regKey)) continue;
      } else if (!r.re.test(name)) continue;
      if (r.pub && !r.pub.test(pub)) continue;
      let exes = r.exes || [];
      if (!Array.isArray(exes)) {
        const picked = [];
        for (const [k, v] of Object.entries(exes)) if (new RegExp(k, 'i').test(name)) picked.push(...v);
        exes = picked;
      }
      return { cat: r.cat, kind: r.kind, desc: r.desc, advice: r.advice || null, flags: r.flags || [], exes, matched: true };
    }
    // Store packages without a Start-menu entry are background components (codecs, extensions, runtimes)
    if (app.source === 'store' && app.hasStartEntry === false) {
      return { cat: C.STORE, kind: 'system', desc: 'Hintergrundkomponente aus dem Microsoft Store (ohne eigenes Startmenü-Symbol).', advice: null, flags: [], exes: [], matched: false };
    }
    if (app.source === 'store') {
      return { cat: C.STORE, kind: 'app', desc: null, advice: null, flags: [], exes: [], matched: false };
    }
    return { cat: C.OTHER, kind: 'app', desc: null, advice: null, flags: [], exes: [], matched: false };
  };

  /* ---------- end-of-support knowledge (dates verified Oct 2026) ---------- */
  LC.DOTNET_EOL = {
    // major version -> end of support (ISO). 8 and 9 both end 2026-11-10; 10 is LTS until Nov 2028.
    1: '2019-06-27', 2: '2021-08-21', 3: '2022-12-13', 5: '2022-05-10', 6: '2024-11-12', 7: '2024-05-14', 8: '2026-11-10', 9: '2026-11-10', 10: '2028-11-14',
  };

  /** Windows builds -> label and end of servicing for Home/Pro. */
  LC.WIN_BUILDS = [
    { build: 26200, label: 'Windows 11 25H2', end: '2027-10-12' },
    { build: 26100, label: 'Windows 11 24H2', end: '2026-10-13' },
    { build: 22631, label: 'Windows 11 23H2', end: '2025-11-11' },
    { build: 22621, label: 'Windows 11 22H2', end: '2024-10-08' },
    { build: 22000, label: 'Windows 11 21H2', end: '2023-10-10' },
    { build: 19045, label: 'Windows 10 22H2', end: '2025-10-14' },
    { build: 19044, label: 'Windows 10 21H2', end: '2023-06-13' },
    { build: 19043, label: 'Windows 10 21H1', end: '2022-12-13' },
    { build: 19042, label: 'Windows 10 20H2', end: '2022-05-10' },
    { build: 19041, label: 'Windows 10 2004', end: '2021-12-14' },
  ];

  /**
   * Places in Windows the dashboard can open for you (the local server starts them; ids must exist in
   * $OpenTargets in LaptopCheck.ps1). `uri` is shown as a "type this into Win+R" hint when the server cannot open it.
   */
  LC.OPEN_TARGETS = {
    'startup-apps': { label: 'Autostart-Einstellungen öffnen', uri: 'ms-settings:startupapps' },
    'task-manager': { label: 'Task-Manager öffnen', uri: 'taskmgr' },
    'apps-features': { label: 'Installierte Apps öffnen', uri: 'ms-settings:appsfeatures' },
    storage: { label: 'Speicher-Einstellungen öffnen', uri: 'ms-settings:storagesense' },
    'disk-cleanup': { label: 'Datenträgerbereinigung öffnen', uri: 'cleanmgr' },
    'windows-update': { label: 'Windows Update öffnen', uri: 'ms-settings:windowsupdate' },
    'windows-security': { label: 'Windows-Sicherheit öffnen', uri: 'windowsdefender:' },
    firewall: { label: 'Firewall-Einstellungen öffnen', uri: 'firewall.cpl' },
    uac: { label: 'UAC-Einstellungen öffnen', uri: 'UserAccountControlSettings' },
    'device-manager': { label: 'Geräte-Manager öffnen', uri: 'devmgmt.msc' },
    msconfig: { label: 'Systemkonfiguration (msconfig) öffnen', uri: 'msconfig' },
    power: { label: 'Energieeinstellungen öffnen', uri: 'ms-settings:powersleep' },
    bitlocker: { label: 'BitLocker öffnen', uri: 'control /name Microsoft.BitLockerDriveEncryption' },
    terminal: { label: 'PowerShell öffnen', uri: 'powershell' },
  };

  /* ---------- files & cloud ---------- */
  LC.CAT_LABELS = ['Textdokumente', 'Tabellen', 'Präsentationen', 'PDF', 'Bilder', 'Videos', 'Audio', 'Archive', 'Installer', 'Code', 'Daten', 'Sonstiges'];
  /** Category groups for charts (7 groups stay readable). cats = indexes into the scanner's category list. */
  LC.CAT_GROUPS = [
    { id: 'docs', label: 'Dokumente', cats: [0, 1, 2, 3] },
    { id: 'images', label: 'Bilder', cats: [4] },
    { id: 'video', label: 'Videos', cats: [5] },
    { id: 'audio', label: 'Audio', cats: [6] },
    { id: 'archives', label: 'Archive & Installer', cats: [7, 8] },
    { id: 'code', label: 'Code & Daten', cats: [9, 10] },
    { id: 'other', label: 'Sonstiges', cats: [11] },
  ];

  /** A calm, numbered top-level structure for a cloud drive. Sorting happens by number, names stay human. */
  LC.DRIVE_STRUCTURE = [
    { name: '00 Eingang', desc: 'Neues, noch Unsortiertes. Wird regelmäßig (z. B. sonntags) einsortiert oder gelöscht.' },
    { name: '01 Persönlich', desc: 'Ausweise, Gesundheit, Wohnen, Familie, Reisen.' },
    { name: '02 Finanzen', desc: 'Steuer (je Jahr), Rechnungen, Verträge, Versicherungen, Bank.' },
    { name: '03 Beruf & Karriere', desc: 'Lebenslauf, Zeugnisse, Zertifikate, Weiterbildung.' },
    { name: '04 Studium & Lernen', desc: 'Kurse, Skripte, Abschlussarbeiten.' },
    { name: '05 Projekte', desc: 'Ein Ordner je Projekt: Planung, Material, Ergebnisse (Code gehört nach GitHub).' },
    { name: '06 Medien', desc: 'Fotos (je Jahr), Videos, Musik.' },
    { name: '99 Archiv', desc: 'Abgeschlossenes, nach Jahr geordnet – wird nicht mehr angefasst.' },
  ];

  /** Folder-name heuristics: where should a local folder go in the cloud? (first match wins) */
  LC.FOLDER_RULES = [
    { id: 'finance', re: /steuer|\btax\b|finanz|rechnung|invoice|beleg|kontoauszug|bank|versicherung|vertr[aä]ge?|\brente\b|gehalt|lohn|abrechnung|nebenkosten|spende/i, top: '02 Finanzen', label: 'Finanzen & Verträge' },
    { id: 'career', re: /lebenslauf|\bcv\b|bewerbung|zeugnis|arbeitgeber|\barbeit\b|\bjob\b|karriere|zertifikat|weiterbildung|praktikum/i, top: '03 Beruf & Karriere', label: 'Beruf & Karriere' },
    { id: 'study', re: /\buni\b|universit|studium|vorlesung|seminar|hausarbeit|thesis|bachelor|\bmaster\b|klausur|skript|lernen|\bkurs/i, top: '04 Studium & Lernen', label: 'Studium & Lernen' },
    { id: 'personal', re: /ausweis|reisepass|geburt|heirat|gesundheit|arzt|medizin|impf|wohnung|miete|mietvertrag|immobil|\bimmo|\bauto\b|kfz|fahrzeug|familie|privat|reise|urlaub/i, top: '01 Persönlich', label: 'Persönliches' },
  ];

  /* ---------- tools catalogue (projects page): match installed programs, give winget ids ---------- */
  LC.TOOL_CATALOG = [
    { key: 'git', label: 'Git', alias: /^git( for windows)?$/i, re: /^git\b|git for windows/i, winget: 'Git.Git' },
    { key: 'node', label: 'Node.js', alias: /^node(\.?js)?$/i, re: /node\.js/i, winget: 'OpenJS.NodeJS.LTS' },
    { key: 'python', label: 'Python', alias: /^python( ?3)?$/i, re: /^python \d/i, winget: 'Python.Python.3.13' },
    { key: 'vscode', label: 'Visual Studio Code', alias: /^(vs ?code|vscode|visual studio code)$/i, re: /visual studio code/i, winget: 'Microsoft.VisualStudioCode' },
    { key: 'vs', label: 'Visual Studio', alias: /^visual studio( community)?$/i, re: /^(microsoft )?visual studio (community|professional|enterprise)/i, winget: 'Microsoft.VisualStudio.2022.Community' },
    { key: 'dotnet', label: '.NET SDK', alias: /^\.?net( sdk)?$/i, re: /\.net.*sdk/i, winget: null },
    { key: 'java', label: 'Java JDK', alias: /^(java|jdk|openjdk)$/i, re: /jdk|java development|temurin|openjdk/i, winget: 'EclipseAdoptium.Temurin.21.JDK' },
    { key: 'docker', label: 'Docker Desktop', alias: /^docker( desktop)?$/i, re: /docker desktop/i, winget: 'Docker.DockerDesktop' },
    { key: 'chrome', label: 'Google Chrome', alias: /^(google )?chrome$/i, re: /google chrome/i, winget: 'Google.Chrome' },
    { key: 'firefox', label: 'Mozilla Firefox', alias: /^(mozilla )?firefox$/i, re: /mozilla firefox/i, winget: 'Mozilla.Firefox' },
    { key: 'githubdesktop', label: 'GitHub Desktop', alias: /^github desktop$/i, re: /github desktop/i, winget: 'GitHub.GitHubDesktop' },
    { key: 'ghcli', label: 'GitHub CLI', alias: /^(gh|github cli)$/i, re: /github cli/i, winget: 'GitHub.cli' },
    { key: 'gdrive', label: 'Google Drive für Desktop', alias: /^google drive( für desktop| for desktop)?$/i, re: /google drive/i, winget: 'Google.GoogleDrive' },
    { key: 'powershell7', label: 'PowerShell 7', alias: /^powershell( ?7)?$/i, re: /^powershell 7/i, winget: 'Microsoft.PowerShell' },
    { key: 'terminal', label: 'Windows Terminal', alias: /^windows terminal$/i, re: /windows terminal/i, winget: 'Microsoft.WindowsTerminal' },
    { key: 'postman', label: 'Postman', alias: /^postman$/i, re: /postman/i, winget: 'Postman.Postman' },
    { key: 'dbeaver', label: 'DBeaver', alias: /^dbeaver$/i, re: /dbeaver/i, winget: 'dbeaver.dbeaver' },
    { key: 'obsidian', label: 'Obsidian', alias: /^obsidian$/i, re: /obsidian/i, winget: 'Obsidian.Obsidian' },
    { key: 'androidstudio', label: 'Android Studio', alias: /^android studio$/i, re: /android studio/i, winget: 'Google.AndroidStudio' },
    { key: 'ollama', label: 'Ollama', alias: /^ollama$/i, re: /ollama/i, winget: 'Ollama.Ollama' },
    { key: 'lmstudio', label: 'LM Studio', alias: /^lm ?studio$/i, re: /lm studio/i, winget: 'ElementLabs.LMStudio' },
    { key: 'blender', label: 'Blender', alias: /^blender$/i, re: /blender/i, winget: 'BlenderFoundation.Blender' },
    { key: 'gimp', label: 'GIMP', alias: /^gimp$/i, re: /gimp/i, winget: 'GIMP.GIMP' },
    { key: 'vlc', label: 'VLC', alias: /^vlc$/i, re: /vlc media player/i, winget: 'VideoLAN.VLC' },
    { key: '7zip', label: '7-Zip', alias: /^7-?zip$/i, re: /7-zip/i, winget: '7zip.7zip' },
    { key: 'unityhub', label: 'Unity Hub', alias: /^unity( hub)?$/i, re: /^unity hub/i, winget: 'Unity.UnityHub' },
    { key: 'godot', label: 'Godot Engine', alias: /^godot( engine)?$/i, re: /godot/i, winget: 'GodotEngine.GodotEngine' },
    { key: 'epic', label: 'Epic Games Launcher (Unreal Engine)', alias: /^(epic games( launcher)?|unreal( engine)?)$/i, re: /epic games launcher|unreal engine/i, winget: 'EpicGames.EpicGamesLauncher' },
    { key: 'steam', label: 'Steam (SteamVR)', alias: /^(steam|steamvr)$/i, re: /^steam$/i, winget: 'Valve.Steam' },
    { key: 'questhub', label: 'Meta Quest Developer Hub', alias: /^(meta )?quest( developer hub)?$/i, re: /quest developer hub|meta quest link|oculus/i, winget: null },
    { key: 'gitlfs', label: 'Git LFS', alias: /^git[- ]?lfs$/i, re: /git lfs/i, winget: 'GitHub.GitLFS' },
    { key: 'krita', label: 'Krita', alias: /^krita$/i, re: /^krita/i, winget: 'KDE.Krita' },
    { key: 'audacity', label: 'Audacity', alias: /^audacity$/i, re: /^audacity/i, winget: 'Audacity.Audacity' },
    { key: 'figma', label: 'Figma', alias: /^figma$/i, re: /^figma/i, winget: 'Figma.Figma' },
    { key: 'notepadpp', label: 'Notepad++', alias: /^notepad\+\+$/i, re: /notepad\+\+/i, winget: 'Notepad++.Notepad++' },
  ];
  /** GitHub "primary language" -> tools you typically need to work on such a repo (keys of TOOL_CATALOG). */
  LC.LANG_TOOLS = {
    JavaScript: ['git', 'node', 'vscode', 'chrome'],
    TypeScript: ['git', 'node', 'vscode'],
    HTML: ['git', 'vscode', 'chrome'],
    CSS: ['git', 'vscode', 'chrome'],
    Python: ['git', 'python', 'vscode'],
    'Jupyter Notebook': ['git', 'python', 'vscode'],
    'C#': ['git', 'dotnet', 'vs'],
    Java: ['git', 'java', 'vscode'],
    PowerShell: ['git', 'powershell7', 'vscode'],
    Shell: ['git', 'vscode'],
    Go: ['git', 'vscode'],
    Rust: ['git', 'vscode'],
    'C++': ['git', 'vs'],
    Dockerfile: ['git', 'docker'],
    Kotlin: ['git', 'androidstudio'],
    GDScript: ['git', 'godot'],
    ShaderLab: ['git', 'unityhub'],
  };
  /** Files in the root of a repository that tell which tools it needs (keys of TOOL_CATALOG). */
  LC.MARKER_TOOLS = {
    'package.json': ['node'], 'requirements.txt': ['python'], 'pyproject.toml': ['python'], Pipfile: ['python'],
    'manifest.json': ['chrome'], 'project.godot': ['godot'], ProjectSettings: ['unityhub'], '*.uproject': ['epic'],
    Dockerfile: ['docker'], 'docker-compose.yml': ['docker'], 'build.gradle': ['androidstudio'], 'build.gradle.kts': ['androidstudio'], 'AndroidManifest.xml': ['androidstudio'],
    '*.sln': ['vs'], '*.csproj': ['dotnet'],
  };
  LC.RESOURCE_KINDS = {
    program: 'Programm / Tool',
    system: 'System / Dienst',
    file: 'Datei / Ordner',
    hardware: 'Hardware',
    account: 'Konto / Zugang',
    knowledge: 'Wissen / Lernen',
    other: 'Sonstiges',
  };
  LC.PROJECT_STATUS = { idea: 'Idee', planned: 'Geplant', active: 'In Arbeit', paused: 'Pausiert', done: 'Fertig' };

  /* ---------- relations: what hangs on a program? (used by the "Aufräumen" page) ----------
   * re         matches the program name (installed software list)
   * exts       file types that (mainly) belong to this program
   * data       regexes for folder names in AppData / ProgramData / the profile that hold its data
   * uses       programs it NEEDS (removing those breaks it)                 -> {re, why}
   * helpers    programs usually installed FOR it (orphan candidates)       -> {re, why, maybe?}
   * servesFor  this program is a helper for those programs                 -> {re, why}
   * hw         device it drives (gpu | tablet)                               -> {kind, re}
   * cloud      id of the cloud provider this program syncs (gdrive, onedrive, dropbox, proton)
   * tip        what to check before removing it
   * sharedData its data folder is shared with other programs of the vendor
   */
  LC.RELATIONS = [
    { id: 'blender', re: /^blender(\s+\d[\d.]*)?$/i, exts: ['.blend', '.blend1', '.blend2'], data: [/^blender( foundation)?$/i],
      tip: 'Szenen (.blend) lassen sich ohne Blender nicht mehr öffnen. Texturen, HDRIs und Render-Ausgaben liegen meist in eigenen Ordnern – die bleiben erhalten, sind aber ohne Blender nutzlos, solange du sie nicht in anderen Programmen brauchst.' },
    { id: 'tablet', re: /gaomon|wacom|huion|xp-?pen|veikk|ugee|tablet driver|pen tablet/i, hw: { kind: 'tablet' },
      servesFor: [{ re: /blender|krita|gimp|photoshop|clip studio|illustrator|inkscape|affinity|medibang|paint tool sai|corel ?draw|sketchbook|davinci|after effects/i, why: 'Zeichen-/Grafikprogramm, das mit dem Zeichentablett arbeitet' }],
      tip: 'Treiber für ein Zeichentablett. Ohne Treiber funktioniert es nur als einfache Maus (ohne Druckstärke). Nur nötig, solange das Tablett benutzt wird.' },
    { id: 'gimp', re: /^gimp\b/i, exts: ['.xcf'], data: [/^gimp/i] },
    { id: 'krita', re: /^krita\b/i, exts: ['.kra'], data: [/^krita$/i] },
    { id: 'inkscape', re: /^inkscape\b/i, data: [/^inkscape$/i] },
    { id: 'audacity', re: /^audacity\b/i, exts: ['.aup3', '.aup'], data: [/^audacity$/i] },
    { id: 'obs', re: /^obs studio\b/i, data: [/^obs-studio$/i], tip: 'Aufnahmen landen standardmäßig im Ordner „Videos“ – sie werden beim Entfernen NICHT gelöscht und bleiben abspielbar.' },
    { id: 'vlc', re: /^vlc media player\b/i, data: [/^vlc$/i] },
    { id: 'photoshop', re: /adobe photoshop/i, exts: ['.psd', '.psb'], data: [/^adobe$/i], sharedData: true },
    { id: 'illustrator', re: /adobe illustrator/i, exts: ['.ai'], data: [/^adobe$/i], sharedData: true },
    { id: 'premiere', re: /adobe premiere/i, exts: ['.prproj'], data: [/^adobe$/i], sharedData: true },
    { id: 'aftereffects', re: /adobe after effects/i, exts: ['.aep'], data: [/^adobe$/i], sharedData: true },
    { id: 'lightroom', re: /adobe (photoshop )?lightroom/i, exts: ['.lrcat'], data: [/^adobe$/i], sharedData: true, tip: 'Der Lightroom-Katalog (.lrcat) enthält deine Bearbeitungen – vorher sichern.' },
    { id: 'resolve', re: /davinci resolve/i, exts: ['.drp', '.drt'], data: [/blackmagic design/i, /^davinci resolve$/i] },
    { id: 'unity', re: /^unity( hub)?\b/i, exts: ['.unity', '.unitypackage'], data: [/^unity(hub)?$/i, /^unityhub$/i] },
    { id: 'unreal', re: /epic games launcher|unreal engine/i, exts: ['.uproject', '.uasset', '.umap'], data: [/^epicgameslauncher$/i, /^unrealengine$/i], tip: 'Epic-Spiele und Unreal-Versionen liegen in eigenen Ordnern und gehen lokal verloren (Spielstände meist in der Cloud des Spiels).' },
    { id: 'vscode', re: /^microsoft visual studio code|^visual studio code/i, data: [/^code$/i, /^\.vscode$/i], tip: 'Einstellungen und Erweiterungen (AppData\\Roaming\\Code, .vscode) bleiben nach dem Entfernen liegen.' },
    { id: 'vs', re: /^(microsoft )?visual studio (community|professional|enterprise|build tools)/i, exts: ['.sln', '.csproj', '.vcxproj', '.vbproj'], data: [/^visualstudio/i, /^microsoft visual studio$/i],
      helpers: [{ re: /visual studio installer/i, why: 'Teil von Visual Studio' }, { re: /windows software development kit|windows sdk/i, why: 'Windows-SDK, wird mit Visual Studio für C++/UWP installiert', maybe: true }, { re: /\.net (core )?sdk|microsoft \.net sdk/i, why: '.NET-SDK, wird mit Visual Studio installiert (auch von Kommandozeile/VS Code genutzt)', maybe: true }],
      tip: 'Visual Studio und seine Workloads belegen schnell 10–50 GB. Projektdateien (.sln) bleiben erhalten; ohne Visual Studio lassen sie sich nur in VS Code/Rider bearbeiten.' },
    { id: 'androidstudio', re: /^android studio\b/i, data: [/^android$/i, /^\.android$/i, /^\.gradle$/i],
      helpers: [{ re: /android (sdk|emulator)|intel.*haxm|hardware accelerated execution manager/i, why: 'Wird für Emulator und Builds von Android Studio installiert' }],
      tip: 'Das Android-SDK (AppData\\Local\\Android) und der Gradle-Cache (.gradle) belegen oft viele GB und bleiben beim Entfernen liegen.' },
    { id: 'docker', re: /^docker desktop\b/i, data: [/^docker/i, /^\.docker$/i], uses: [{ re: /windows subsystem for linux|^wsl\b/i, why: 'Docker Desktop läuft über WSL 2 (WSL nutzt du evtl. auch selbst)', maybe: true }],
      tip: 'Docker legt Images und Container in einer virtuellen Festplatte (AppData\\Local\\Docker, oft viele GB) ab. Wenn du daraus etwas brauchst, vorher in Docker Desktop „Clean / Purge data“ bzw. Images exportieren.' },
    { id: 'git', re: /^git( for windows)?\b/i, repoTool: 'git',
      tip: 'Git wird von allen lokalen Repositories, von GitHub Desktop (bringt eigenes Git mit), VS Code und der Kommandozeile benutzt. Ohne Git kannst du per Kommandozeile nicht mehr committen/pushen.' },
    { id: 'githubdesktop', re: /^github desktop\b/i, data: [/^githubdesktop$/i], tip: 'GitHub Desktop bringt ein eigenes Git mit; deine Repositories und ihr GitHub-Stand bleiben unberührt.' },
    { id: 'node', re: /^node\.?js\b/i, repoTool: 'node', data: [/^npm$/i, /^npm-cache$/i, /^node-gyp$/i, /^nvm$/i, /^\.npm$/i],
      tip: 'Projekte mit package.json laufen ohne Node.js nicht mehr; node_modules lässt sich mit „npm ci“ jederzeit neu aufbauen.' },
    { id: 'python', re: /^python \d/i, repoTool: 'python', exts: ['.py', '.pyw'], data: [/^python/i, /^pip$/i],
      helpers: [{ re: /python launcher|py launcher/i, why: 'Gehört zu Python' }],
      tip: 'Pakete (pip) und virtuelle Umgebungen (.venv) deiner Projekte hängen an einer Python-Version. Skripte (.py) laufen danach nicht mehr.' },
    { id: 'java', re: /\bjdk\b|java development kit|temurin|openjdk|java\(tm\) se development/i, exts: ['.jar'], repoTool: 'java',
      tip: 'Viele Programme (Minecraft, Android Studio, IntelliJ) bringen ihr eigenes Java mit. Ein einzelnes JDK brauchst du nur, wenn ein Programm ausdrücklich „Java installiert“ verlangt oder du selbst Java-Programme baust.' },
    { id: 'steam', re: /^steam$/i, data: [/^steam$/i], tip: 'Installierte Spiele liegen im Ordner „steamapps“ – sie gehen mit Steam lokal verloren (Spielstände meist in der Steam Cloud). Vorher einzelne Spiele in Steam deinstallieren oder den Spiele-Ordner verschieben.' },
    { id: 'gdrive', re: /google drive/i, cloud: 'gdrive', data: [/^drivefs$/i, /^google$/i], sharedData: true },
    { id: 'onedrive', re: /^microsoft onedrive|^onedrive/i, cloud: 'onedrive' },
    { id: 'dropbox', re: /^dropbox/i, cloud: 'dropbox', data: [/^dropbox$/i] },
    { id: 'proton', re: /^proton drive/i, cloud: 'proton', data: [/^proton ?drive$/i] },
    { id: 'ollama', re: /^ollama\b/i, data: [/^ollama$/i, /^\.ollama$/i], tip: 'Heruntergeladene KI-Modelle (.ollama\\models) belegen oft viele GB und bleiben beim Entfernen liegen – gut zum Freiräumen.' },
    { id: 'lmstudio', re: /^lm studio\b/i, data: [/^lm-studio$/i, /^\.lmstudio$/i], tip: 'Modelle liegen in .lmstudio / .cache\\lm-studio und belegen oft viele GB.' },
    { id: 'office', re: /microsoft (office|365)|office 16|microsoft 365/i, exts: ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'], tip: 'Deine Office-Dateien bleiben erhalten, lassen sich aber nur mit einem anderen Programm (LibreOffice, Google Docs) öffnen.' },
    { id: 'libreoffice', re: /^libreoffice\b/i, exts: ['.odt', '.ods', '.odp'] },
    { id: '7zip', re: /^7-zip\b/i, exts: ['.7z'] },
    { id: 'winrar', re: /^winrar\b/i, exts: ['.rar'] },
    { id: 'pdf', re: /adobe acrobat|acrobat reader|foxit|sumatra ?pdf/i, exts: ['.pdf'], tip: 'Windows öffnet PDF-Dateien danach mit dem Browser (Edge).' },
    { id: 'gpu', re: /nvidia (graphics driver|grafiktreiber)|amd (software|radeon|adrenalin)|intel.*(graphics driver|arc)/i, hw: { kind: 'gpu' }, protect: true,
      tip: 'Grafiktreiber: ohne ihn läuft die Anzeige nur mit dem einfachen Windows-Treiber (langsam, kein 3D). Nur für eine saubere Neuinstallation entfernen.' },
    { id: 'gpu-helper', re: /nvidia (physx|hd audio|frameview|broadcast)|geforce experience|nvidia app/i, servesFor: [{ re: /nvidia (graphics driver|grafiktreiber)/i, why: 'Zusatzsoftware zum NVIDIA-Grafiktreiber' }] },
  ];
  LC.REL_GROUPS = {
    dependants: { label: 'Davon hängt etwas ab', help: 'Diese Programme brauchen es – sie funktionieren danach nicht mehr.' },
    projects: { label: 'Deine Projekte & Repos', help: 'In deiner Projektplanung bzw. bei GitHub-Repos wird es als nötig geführt.' },
    files: { label: 'Dateien, die damit geöffnet werden', help: 'Diese Dateien bleiben liegen – Windows kann sie danach nur noch mit einem anderen Programm öffnen.' },
    data: { label: 'Daten & Einstellungen des Programms', help: 'Das Deinstallationsprogramm lässt diese Ordner meist liegen. Sie belegen Platz – prüfe, ob du Einstellungen oder Daten daraus brauchst.' },
    helpers: { label: 'Begleitprogramme', help: 'Vermutlich nur dafür installiert – nach dem Entfernen oft überflüssig.' },
    family: { label: 'Gehört dazu', help: 'Gleicher Hersteller/Installationsordner – wird oft zusammen entfernt.' },
    startup: { label: 'Autostart & Verknüpfungen', help: 'Verschwindet mit dem Programm.' },
    hardware: { label: 'Hardware', help: 'Geräte, für die es zuständig ist.' },
    cloud: { label: 'Cloud-Speicher', help: 'Dateien in dieser Cloud sind danach lokal nicht mehr verfügbar.' },
    peers: { label: 'Ähnliche Programme', help: 'Gleiches Einsatzgebiet – falls du eines davon als Ersatz behalten willst.' },
  };
  LC.IMPACT = {
    breaks: { label: 'Funktioniert danach nicht mehr', rank: 5 },
    data: { label: 'Deine Daten – prüfen/sichern', rank: 4 },
    degrades: { label: 'Eingeschränkt danach', rank: 3 },
    orphan: { label: 'Danach vermutlich überflüssig', rank: 2 },
    leftover: { label: 'Bleibt liegen – extra entfernen', rank: 1 },
    info: { label: 'Zur Info', rank: 0 },
  };

  /** Wi-Fi generation guess from the adapter description. */
  LC.wifiGeneration = (desc) => {
    const d = String(desc || '');
    const rules = [
      [/BE2\d\d|BE\d{3}|Wi-?Fi 7|MT7925|RZ717|WCN7850/i, 7],
      [/AX2(10|11)|AX411|AX1675|AX1690|Wi-?Fi 6E|MT7922|RZ616|RTL8852CE|WCN685|AXE\d/i, 6.5],
      [/AX2(00|01|03)|AX101|AX1650|AX1651|Wi-?Fi 6\b|MT7921|RTL8852|RTL8832|QCA6390|WCN6856|WCN6855|Killer\(R\) Wi-?Fi 6|AX\d{3}/i, 6],
      [/AC ?(7260|7265|8260|8265|9260|9461|9462|9560|3160|3165|3168)|Wireless-AC|Wi-?Fi 5|RTL8821|RTL8822|RTL8812|QCA61|QCA9377|QCA9984|802\.11ac|AC \d{4}/i, 5],
      [/Wireless-N|N ?(6205|6235|7260|4965|5100|5300|1030|135)|802\.11n|AR9\d|RTL81(88|92)|Wi-?Fi 4/i, 4],
    ];
    for (const [re, gen] of rules) if (re.test(d)) return gen;
    return null;
  };
  LC.wifiLabel = (g) => (g == null ? null : g === 6.5 ? 'Wi-Fi 6E' : 'Wi-Fi ' + g);
})(typeof window !== 'undefined' ? window : globalThis);
