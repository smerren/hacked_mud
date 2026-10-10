; Inno Setup script for the windows installer. Don't compile this directly, run installer\build.ps1
; build.ps1 passes AppVersion, StageDir, VendorDir, OutputDir and SandboxieInstaller via /D

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "hacked mud"
#define AppExe "hacked_mud.exe"
#define SandboxName "HackmudAlt"

[Setup]
AppId={{F3B8FDD4-CA0F-4551-8736-E94F9CE1FC7E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=hacked mud
AppPublisherURL=https://cakeeatergames.github.io/hacked_mud/
; per-user install: no admin needed, and logs/cache can live next to the exe
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=hacked_mud-setup-{#AppVersion}
SetupIconFile=..\frontend\public\favicon.ico
UninstallDisplayIcon={app}\{#AppExe}
LicenseFile=..\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "multibox"; Description: "Set up a second Steam account (installs Sandboxie-Plus, asks for admin rights)"; GroupDescription: "Multiple hackmud instances:"; Flags: unchecked

[InstallDelete]
; drop dashboard files from older versions
Type: filesandordirs; Name: "{app}\dashboard"

[Files]
Source: "{#StageDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\dashboard\*"; DestDir: "{app}\dashboard"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "setup-sandbox.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion; Tasks: multibox
Source: "clear-steam-autologin.cmd"; DestDir: "{app}\tools"; Flags: ignoreversion; Tasks: multibox
Source: "THIRD_PARTY.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#VendorDir}\{#SandboxieInstaller}"; DestDir: "{tmp}"; Flags: deleteafterinstall; Tasks: multibox

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\Steam (second account)"; Filename: "{commonpf64}\Sandboxie-Plus\Start.exe"; Parameters: "/box:{#SandboxName} ""{code:SteamExe}"""; IconFilename: "{code:SteamExe}"; Tasks: multibox
Name: "{autodesktop}\Steam (second account)"; Filename: "{commonpf64}\Sandboxie-Plus\Start.exe"; Parameters: "/box:{#SandboxName} ""{code:SteamExe}"""; IconFilename: "{code:SteamExe}"; Tasks: multibox and desktopicon

[Run]
; Sandboxie's own installer needs admin, shellexec makes windows show the UAC prompt for it
Filename: "{tmp}\{#SandboxieInstaller}"; Parameters: "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART"; StatusMsg: "Installing Sandboxie-Plus..."; Flags: shellexec waituntilterminated; Tasks: multibox; Check: not IsSandboxieInstalled
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\setup-sandbox.ps1"" -Box {#SandboxName}"; StatusMsg: "Creating the {#SandboxName} sandbox..."; Flags: runhidden waituntilterminated; Tasks: multibox
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: filesandordirs; Name: "{app}\cache"

[Code]
const
  HackmudAppId = '469920';

function SteamExe(Param: String): String;
begin
  if not RegQueryStringValue(HKCU, 'Software\Valve\Steam', 'SteamExe', Result) then
    Result := ExpandConstant('{commonpf32}\Steam\steam.exe');
  StringChangeEx(Result, '/', '\', True);
end;

function IsSandboxieInstalled: Boolean;
begin
  Result := FileExists(ExpandConstant('{commonpf64}\Sandboxie-Plus\SbieIni.exe'));
end;

function IsHackmudInstalled: Boolean;
var
  Installed: Cardinal;
begin
  Result := RegQueryDWordValue(HKCU, 'Software\Valve\Steam\Apps\' + HackmudAppId, 'Installed', Installed)
    and (Installed = 1);
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if not RegKeyExists(HKCU, 'Software\Valve\Steam') then
    MsgBox('Steam doesn''t seem to be installed.' + #13#10 + #13#10 +
      'hacked mud works on top of the hackmud game, which needs Steam. ' +
      'You can continue and install Steam (store.steampowered.com) and hackmud afterwards.',
      mbInformation, MB_OK)
  else if not IsHackmudInstalled then
    MsgBox('hackmud doesn''t seem to be installed in Steam.' + #13#10 + #13#10 +
      'You can continue and install hackmud afterwards.',
      mbInformation, MB_OK);
end;
