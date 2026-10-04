' Opens the world-time board in its own Edge window. No console.
'
' electron.exe on this PC exits with an access violation before it can create a window,
' including `electron --version` unless the sandbox is disabled, and a window still never
' appears. Edge is already installed and does open windows, so the shortcut uses that.
' widget.html is one classic script because Edge blocks the module page on file://.
Option Explicit

Dim shell, fso, root, page, edge, profile, url
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
page = root & "\dist\renderer\widget.html"

edge = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edge) Then
	edge = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
End If

If Not fso.FileExists(edge) Or Not fso.FileExists(page) Then
	MsgBox "The widget has not been built yet." & vbCrLf & vbCrLf & "From this folder, run: npm run build", vbExclamation, "World time"
	WScript.Quit 1
End If

profile = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\WorldTime"
url = "file:///" & Replace(page, "\", "/")

shell.Run """" & edge & """ --user-data-dir=""" & profile & """ --app=""" & url & """ --window-size=920,640 --window-position=80,60 --no-first-run --no-default-browser-check", 1, False
