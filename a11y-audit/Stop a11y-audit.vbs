' Double-click to stop the a11y-audit server that "Start a11y-audit.vbs"
' launched in the background. Safe to run even if it's not running.

Option Explicit

Dim shell, execObj, output, linesArr, line, tokens, i, j, pid, lastTok, killed

Set shell = CreateObject("WScript.Shell")
killed = False

On Error Resume Next
Set execObj = shell.Exec("cmd /c netstat -ano | findstr "":4174"" | findstr LISTENING")
output = execObj.StdOut.ReadAll()
On Error Goto 0

If Len(output) > 0 Then
    linesArr = Split(output, vbCrLf)
    For i = 0 To UBound(linesArr)
        line = Trim(linesArr(i))
        If Len(line) > 0 Then
            tokens = Split(line, " ")
            lastTok = ""
            For j = 0 To UBound(tokens)
                If Len(Trim(tokens(j))) > 0 Then lastTok = Trim(tokens(j))
            Next
            pid = lastTok
            If Len(pid) > 0 And IsNumeric(pid) Then
                shell.Run "taskkill /F /PID " & pid, 0, True
                killed = True
            End If
        End If
    Next
End If

If killed Then
    MsgBox "a11y-audit server stopped.", 64, "a11y-audit"
Else
    MsgBox "No a11y-audit server was found running on port 4174.", 64, "a11y-audit"
End If
