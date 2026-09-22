' Double-click this file to start a11y-audit and open it in your browser —
' no command prompt window, ever. It starts the server hidden in the
' background, waits until it's actually ready to answer requests, then
' opens http://localhost:4174 in your default browser.
'
' The server keeps running in the background after you close the browser
' tab (so re-opening the page later doesn't need re-launching). To stop it
' completely, double-click "Stop a11y-audit.vbs", or just restart your PC.

Option Explicit

Dim fso, shell, scriptDir, logPath, port, url, http, attempt, maxAttempts, ready

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
logPath = scriptDir & "\server-log.txt"
port = "4174"
url = "http://localhost:" & port & "/"

shell.CurrentDirectory = scriptDir

' 0 = fully hidden window, False = don't wait for it to exit (it's a
' long-running server). Output is redirected to a log file so there's
' still somewhere to look if something goes wrong, since there's no
' visible console to read.
shell.Run "cmd /c npm run serve > """ & logPath & """ 2>&1", 0, False

' Poll until the server actually responds instead of guessing a fixed
' delay — the first run also compiles the TypeScript, which takes a few
' seconds.
ready = False
maxAttempts = 90
For attempt = 1 To maxAttempts
    WScript.Sleep 1000
    ready = False
    On Error Resume Next
    Set http = Nothing
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    If Not http Is Nothing Then
        http.Open "GET", url, False
        http.Send
        If Err.Number = 0 And http.Status = 200 Then
            ready = True
        End If
    End If
    On Error Goto 0
    If ready Then Exit For
Next

shell.Run url

If Not ready Then
    MsgBox "a11y-audit is taking longer than expected to start (over " & maxAttempts & " seconds)." & vbCrLf & vbCrLf & _
        "It may still be starting in the background — try opening " & url & " in a moment." & vbCrLf & vbCrLf & _
        "If that still doesn't work, check server-log.txt in this folder for the error.", 48, "a11y-audit"
End If
