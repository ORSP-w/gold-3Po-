#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif

[Setup]
AppId={{A91C11A7-2B84-4F4A-9714-3E0A7A89D32B}
AppName=GOLD-3Po Market Lab
AppVersion={#AppVersion}
AppPublisher=GOLD-3Po
DefaultDirName={localappdata}\Programs\GOLD-3Po
DefaultGroupName=GOLD-3Po Market Lab
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\release
OutputBaseFilename=GOLD-3Po-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\build\GOLD-3Po\assets\GOLD-3Po.ico
WizardImageFile=..\build\GOLD-3Po\assets\WizardImage.bmp
WizardSmallImageFile=..\build\GOLD-3Po\assets\WizardSmallImage.bmp
UninstallDisplayName=GOLD-3Po Market Lab
UninstallDisplayIcon={app}\assets\GOLD-3Po.ico
Uninstallable=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Dirs]
Name: "{app}\data"
Name: "{app}\logs"

[Files]
Source: "..\build\GOLD-3Po\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\GOLD-3Po Market Lab"; Filename: "{app}\Launch-GOLD-3Po.vbs"; WorkingDir: "{app}"; IconFilename: "{app}\assets\GOLD-3Po.ico"
Name: "{autoprograms}\Stop GOLD-3Po"; Filename: "{app}\Stop-GOLD-3Po.vbs"; WorkingDir: "{app}"; IconFilename: "{app}\assets\GOLD-3Po.ico"
Name: "{autodesktop}\GOLD-3Po Market Lab"; Filename: "{app}\Launch-GOLD-3Po.vbs"; WorkingDir: "{app}"; IconFilename: "{app}\assets\GOLD-3Po.ico"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Launch-GOLD-3Po.vbs"""; Description: "Запустить GOLD-3Po"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Stop-GOLD-3Po.vbs"""; Flags: runhidden; RunOnceId: StopGOLD3Po
